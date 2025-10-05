import { Hono, Context } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { PagesFunction } from '@cloudflare/workers-types';
import { hash, compare } from 'bcrypt-ts';
import { jwt, sign, verify } from 'hono/jwt';
import type { Next } from 'hono';
import { SSEStreamingApi, stream, streamSSE } from 'hono/streaming';
import * as yaml from 'js-yaml';
import { parseNodeLinks, ParsedNode } from '../../src/utils/nodeParser';

// Define Env bindings from wrangler.toml
type Env = {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}

// In-memory stream manager for SSE
class StreamManager {
  private streams: Record<string, { writer: WritableStreamDefaultWriter, userId: string }> = {};

  add(writer: WritableStreamDefaultWriter, userId: string) {
    const streamId = `user-${userId}-${crypto.randomUUID()}`;
    this.streams[streamId] = { writer, userId };
    return streamId;
  }

  remove(streamId: string) {
    if (this.streams[streamId]) {
      delete this.streams[streamId];
    }
  }

  broadcast(userId: string, event: string, data: any | any[]) {
    // If data is an array, send each item as a separate event.
    const messages = Array.isArray(data) ? data : [data];
    const encoder = new TextEncoder();

    for (const item of messages) {
      const message = `event: ${event}\ndata: ${JSON.stringify(item)}\n\n`;
      const encodedMessage = encoder.encode(message);

      Object.entries(this.streams).forEach(([streamId, { writer, userId: streamUserId }]) => {
        if (streamUserId === userId) {
          writer.write(encodedMessage).catch(e => {
            console.error(`Failed to write to stream ${streamId}, it might be closed. Removing.`, e);
            writer.close().catch(() => {}); // Suppress errors on close
            this.remove(streamId);
          });
        }
      });
    }
  }
}

const streamManager = new StreamManager();

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Middleware to handle X-HTTP-Method-Override for Cloudflare Pages compatibility
app.use('*', async (c, next) => {
  const overrideMethod = c.req.header('X-HTTP-Method-Override');
  if (c.req.method === 'POST' && overrideMethod) {
    const newMethod = overrideMethod.toUpperCase();
    if (['PUT', 'DELETE'].includes(newMethod)) {
      // Reconstruct the request with the overridden method.
      const newReq = new Request(c.req.raw, {
        method: newMethod,
      });
      // Manually dispatch the new request to the Hono app.
      return app.fetch(newReq, c.env, c.executionCtx);
    }
  }
  // If no override, continue with the normal flow.
  await next();
});

// Custom authentication middleware
const manualAuthMiddleware = async (c: Context, next: Next) => {
  let token = '';
  const authHeader = c.req.header('Authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const queryToken = c.req.query('token');
    if (queryToken) {
      token = queryToken;
    }
  }

  if (!token || token === 'null') {
    return c.json({ success: false, message: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    return c.json({ success: false, message: 'Internal Server Error: JWT secret not configured' }, 500);
  }

  try {
    const payload = await verify(token, secret);
    c.set('jwtPayload', payload);
    await next();
  } catch (error) {
    return c.json({ success: false, message: 'Unauthorized: Invalid token' }, 401);
  }
};

// Apply authentication middleware to all necessary routes
// We will apply it to each route group explicitly to avoid startup issues.


// Auth routes
const auth = new Hono<{ Bindings: Env }>();

auth.post('/register', async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
        return c.json({ success: false, message: 'Missing username or password' }, 400);
    }
    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existingUser) {
        return c.json({ success: false, message: 'Username already exists' }, 409);
    }
    const userCountResult = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'system'").first<{ count: number }>();
    const userCount = userCountResult?.count ?? 0;
    let role = userCount === 0 ? 'admin' : 'user';
    const hashedPassword = await hash(password, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare('INSERT INTO users (id, username, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, username, hashedPassword, role, now, now).run();
    return c.json({ success: true, data: { id, username, role } }, 201);
});

auth.post('/login', async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
        return c.json({ success: false, message: 'Missing username or password' }, 400);
    }
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
    if (!user) {
        return c.json({ success: false, message: 'User not found' }, 404);
    }
    const isPasswordValid = await compare(password, user.password as string);
    if (!isPasswordValid) {
        return c.json({ success: false, message: 'Invalid password' }, 401);
    }
    const payload = { id: user.id, username: user.username, role: user.role || 'user', exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) };
    const token = await sign(payload, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, user: payload } });
});

app.route('/auth', auth);

// Stats route
app.get('/stats', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const [subscriptions, nodes, profiles] = await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE user_id = ?').bind(user.id).first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM nodes WHERE user_id = ?').bind(user.id).first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM profiles WHERE user_id = ?').bind(user.id).first<{ count: number }>()
    ]);
    return c.json({ success: true, data: { subscriptions: subscriptions?.count ?? 0, nodes: nodes?.count ?? 0, profiles: profiles?.count ?? 0 } });
});

// Node routes
const nodes = new Hono<{ Bindings: Env }>();
// We apply middleware manually to each route to avoid conflicts with SSE streaming

nodes.get('/', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM nodes WHERE user_id = ? ORDER BY sort_order ASC').bind(user.id).all();
    return c.json({ success: true, data: results });
});

nodes.post('/', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<any>();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
        `INSERT INTO nodes (id, user_id, name, link, protocol, protocol_params, server, port, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, body.name, body.link, body.protocol, JSON.stringify(body.protocol_params), body.protocol_params?.add || '', Number(body.protocol_params?.port || 0), body.protocol, now, now).run();
    return c.json({ success: true, data: { id } }, 201);
});

nodes.get('/manual-summary', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const countResult = await c.env.DB.prepare("SELECT COUNT(*) as count FROM nodes WHERE user_id = ? AND group_id IS NULL").bind(user.id).first<{ count: number }>();
    const total = countResult?.count ?? 0;
    const { results: previewNodes } = await c.env.DB.prepare("SELECT name FROM nodes WHERE user_id = ? AND group_id IS NULL LIMIT 10").bind(user.id).all<{ name: string }>();
    const preview = previewNodes.map(n => n.name);
    return c.json({ success: true, data: { total, preview } });
});

nodes.delete('/manual', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { meta } = await c.env.DB.prepare("DELETE FROM nodes WHERE user_id = ? AND group_id IS NULL").bind(user.id).run();
    const deletedCount = meta.changes || 0;
    return c.json({ success: true, message: `成功清空 ${deletedCount} 个手动节点。` });
});

nodes.get('/health-check-stream', async (c) => {
    // Temporarily disabled
    return c.text('Service temporarily disabled', 503);
});

nodes.post('/health-check', manualAuthMiddleware, async (c) => {
    // Temporarily disabled
    return c.json({ success: false, message: '该功能正在维护中，已暂时禁用。' }, 503);
});

nodes.post('/batch-delete', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { ids } = await c.req.json<{ ids: string[] }>();
    const stmts = ids.map(id => c.env.DB.prepare('DELETE FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id));
    if (stmts.length > 0) await c.env.DB.batch(stmts);
    return c.json({ success: true });
});

nodes.post('/update-order', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { nodeIds } = await c.req.json<{ nodeIds: string[] }>();

    if (!nodeIds || nodeIds.length === 0) {
        return c.json({ success: false, message: 'No node order provided.' }, 400);
    }

    const stmts = nodeIds.map((id, index) =>
        c.env.DB.prepare('UPDATE nodes SET sort_order = ? WHERE id = ? AND user_id = ?').bind(index, id, user.id)
    );

    try {
        await c.env.DB.batch(stmts);
        return c.json({ success: true, message: 'Node order updated successfully.' });
    } catch (error) {
        console.error('Failed to update node order:', error);
        return c.json({ success: false, message: 'Failed to update node order.' }, 500);
    }
});

nodes.get('/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!node) return c.json({ success: false, message: 'Node not found' }, 404);
    return c.json({ success: true, data: node });
});

nodes.put('/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const body = await c.req.json<{ name: string; link: string }>();
    const now = new Date().toISOString();

    const existingNode = await c.env.DB.prepare('SELECT link FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ link: string }>();

    if (!existingNode) {
        return c.json({ success: false, message: 'Node not found' }, 404);
    }

    if (existingNode.link !== body.link) {
        // Link has changed, re-parse it
        const parsedNodes = parseNodeLinks(body.link);
        if (parsedNodes.length === 0) {
            return c.json({ success: false, message: 'Invalid node link provided' }, 400);
        }
        if (parsedNodes.length > 1) {
            return c.json({ success: false, message: 'Editing with multiple node links is not supported' }, 400);
        }
        const parsedNode = parsedNodes[0];
        
        await c.env.DB.prepare(
            `UPDATE nodes
             SET name = ?, link = ?, protocol = ?, protocol_params = ?, server = ?, port = ?, type = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).bind(
            body.name, // Use the name from the form
            body.link, // Use the new link from the form
            parsedNode.protocol,
            JSON.stringify(parsedNode.protocol_params),
            parsedNode.server,
            parsedNode.port,
            parsedNode.protocol, // `type` is often the same as `protocol`
            now,
            id,
            user.id
        ).run();
    } else {
        // Link is the same, only update the name
        await c.env.DB.prepare(
            `UPDATE nodes SET name = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).bind(body.name, now, id, user.id).run();
    }

    return c.json({ success: true });
});

// Helper function for health check
const checkNodeHealth = async (node: { server: string, port: number | string }): Promise<{ status: 'healthy' | 'unhealthy', latency: number | null, error: string | null }> => {
    if (!node.server || !node.port) {
        return { status: 'unhealthy', latency: null, error: 'Invalid node info' };
    }

    const startTime = Date.now();
    const testUrl = `https://${node.server}:${node.port}`;

    try {
        // Use HEAD request for speed, with a 5-second timeout.
        // This tests reachability and TLS handshake.
        const response = await fetch(testUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
            redirect: 'manual',
        });
        
        const latency = Date.now() - startTime;
        // Any response, even an HTTP error, means the port is open and reachable.
        return { status: 'healthy', latency, error: null };

    } catch (e: any) {
        const latency = Date.now() - startTime;
        
        // If the error is a certificate error, it means we've reached the server.
        // This is a good sign for a connectivity test.
        if (e.message && (e.message.includes('certificate') || e.message.includes('TLS'))) {
            return { status: 'healthy', latency, error: 'Cert Error' };
        }

        // Handle timeouts and other network errors.
        if (e.name === 'TimeoutError') {
            return { status: 'unhealthy', latency: null, error: 'Timeout' };
        }
        
        return { status: 'unhealthy', latency: null, error: 'Network Error' };
    }
};

nodes.post('/:id/test', manualAuthMiddleware, async (c) => {
    // Temporarily disabled
    return c.json({ success: false, message: '该功能正在维护中，已暂时禁用。' }, 503);
});

nodes.delete('/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

nodes.post('/batch-import', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    // The body can now contain either `links` (string) or `nodes` (array of objects)
    const body = await c.req.json<{ links?: string; nodes?: ParsedNode[] }>();

    let nodesToImport: ParsedNode[] = [];

    if (body.nodes && Array.isArray(body.nodes)) {
        // New method: receiving pre-parsed nodes
        nodesToImport = body.nodes;
    } else if (body.links) {
        // Legacy method: receiving a string of links and parsing them
        nodesToImport = parseNodeLinks(body.links);
    }

    if (nodesToImport.length === 0) {
        return c.json({ success: false, message: 'No valid nodes to import' }, 400);
    }

    const now = new Date().toISOString();

    const stmts = nodesToImport.map(node => {
        const id = crypto.randomUUID();
        const protocol = node.protocol || 'unknown';
        const name = node.name || 'Unknown Node';
        const server = node.server || '';
        const port = node.port || 0;
        const link = node.link || node.raw || '';

        return c.env.DB.prepare(
            `INSERT INTO nodes (id, user_id, name, link, protocol, protocol_params, server, port, type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, name, link, protocol, JSON.stringify(node.protocol_params || {}), server, port, protocol, now, now);
    });

    if (stmts.length > 0) {
        await c.env.DB.batch(stmts);
    }

    return c.json({ success: true, message: `Successfully imported ${stmts.length} nodes.` });
});

app.route('/nodes', nodes);

// Node Statuses routes
app.get('/node-statuses', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT id as node_id, status, latency, last_checked, error FROM nodes WHERE user_id = ?').bind(user.id).all();
    const validStatuses = ['pending', 'testing', 'healthy', 'unhealthy'];
    const sanitizedResults = (results as any[]).map(r => ({ ...r, status: validStatuses.includes(r.status) ? r.status : 'pending' }));
    return c.json({ success: true, data: sanitizedResults });
});

// Subscription routes
const subscriptions = new Hono<{ Bindings: Env }>();
subscriptions.use('*', manualAuthMiddleware);

subscriptions.get('/', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(user.id).all();
    return c.json({ success: true, data: results });
});

subscriptions.get('/for-select', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT id, name FROM subscriptions WHERE user_id = ?').bind(user.id).all();
    return c.json({ success: true, data: results });
});

subscriptions.post('/', async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<any>();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
        `INSERT INTO subscriptions (id, user_id, name, url, type, enabled, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        user.id,
        body.name,
        body.url,
        body.type || 'plain', // Add default value
        body.enabled ?? 1,    // Add default value
        now,
        now
    ).run();
    return c.json({ success: true, data: { id } }, 201);
});

subscriptions.post('/batch-import', async (c) => {
    const user = c.get('jwtPayload');
    const { subscriptions: subs } = await c.req.json<{ subscriptions: any[] }>();

    if (!Array.isArray(subs) || subs.length === 0) {
        return c.json({ success: false, message: 'No subscriptions to import' }, 400);
    }

    const now = new Date().toISOString();
    const stmts = subs.map(sub => {
        const id = crypto.randomUUID();
        return c.env.DB.prepare(
            `INSERT INTO subscriptions (id, user_id, name, url, type, enabled, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, sub.name, sub.url, sub.type || 'plain', sub.enabled ?? 1, now, now);
    });

    await c.env.DB.batch(stmts);

    return c.json({ success: true, message: `Successfully imported ${subs.length} subscriptions.` });
});

subscriptions.post('/update-all', async (c) => {
    const user = c.get('jwtPayload');
    const { results: subs } = await c.env.DB.prepare(
        'SELECT id, url FROM subscriptions WHERE user_id = ? AND enabled = 1'
    ).bind(user.id).all<{ id: string; url: string }>();

    if (!subs || subs.length === 0) {
        return c.json({ success: true, message: 'No enabled subscriptions to update.' });
    }

    let updatedCount = 0;
    // This is a simplified sequential update. A real-world scenario might use queues.
    for (const sub of subs) {
        try {
            const response = await fetch(sub.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                const decoder = new TextDecoder('utf-8');
                let content = decoder.decode(buffer, { stream: true });
                if (content.charCodeAt(0) === 0xFEFF) { // Remove BOM
                    content = content.slice(1);
                }
                
                const nodeCount = getAccurateNodeCount(content);
                const now = new Date().toISOString();
                await c.env.DB.prepare(
                    'UPDATE subscriptions SET node_count = ?, last_updated = ?, error = NULL WHERE id = ?'
                ).bind(nodeCount, now, sub.id).run();
                updatedCount++;
            } else {
                 const error = `Failed to fetch: ${response.statusText}`;
                 await c.env.DB.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), error, sub.id).run();
            }
        } catch (error: any) {
            const errorMessage = `Update failed: ${error.message}`;
            await c.env.DB.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), errorMessage, sub.id).run();
        }
    }

    return c.json({ success: true, message: `Updated ${updatedCount} out of ${subs.length} subscriptions.` });
});

// Helper function to apply rules to a list of nodes
const applySubscriptionRules = (nodes: (ParsedNode & { id: string; raw: string; })[], rules: any[]): (ParsedNode & { id: string; raw: string; })[] => {
    let processedNodes = [...nodes];

    for (const rule of rules) {
        if (!rule.enabled) continue;

        try {
            const value = JSON.parse(rule.value);

            if (rule.type === 'filter_by_name_keyword' && value.keywords && value.keywords.length > 0) {
                const lowerCaseKeywords = value.keywords.map((k: string) => k.toLowerCase());
                processedNodes = processedNodes.filter(node => {
                    const lowerCaseName = node.name.toLowerCase();
                    return lowerCaseKeywords.some((keyword: string) => lowerCaseName.includes(keyword));
                });
            }
            else if (rule.type === 'exclude_by_name_keyword' && value.keywords && value.keywords.length > 0) {
                 const lowerCaseKeywords = value.keywords.map((k: string) => k.toLowerCase());
                 processedNodes = processedNodes.filter(node => {
                    const lowerCaseName = node.name.toLowerCase();
                    return !lowerCaseKeywords.some((keyword: string) => lowerCaseName.includes(keyword));
                });
            }
            else if (rule.type === 'filter_by_name_regex' && value.regex) {
                // Check for ignoreCase flag, e.g., (?i)
                const ignoreCase = value.regex.startsWith('(?i)');
                const pattern = ignoreCase ? value.regex.substring(4) : value.regex;
                const regex = new RegExp(pattern, ignoreCase ? 'i' : '');
                processedNodes = processedNodes.filter(node => regex.test(node.name));
            }
            else if (rule.type === 'rename_by_regex' && value.regex && typeof value.format !== 'undefined') {
                const ignoreCase = value.regex.startsWith('(?i)');
                const pattern = ignoreCase ? value.regex.substring(4) : value.regex;
                const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g'); // Use global flag for replace
                processedNodes = processedNodes.map(node => {
                    return { ...node, name: node.name.replace(regex, value.format) };
                });
            }
        } catch (e) {
            console.error(`Error applying rule ${rule.id} (${rule.name}):`, e);
        }
    }

    return processedNodes;
};


const userAgents = [
    'V2RayN/6.23',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'ClashforWindows/0.20.39',
    'Clash Meta for Android/2.9.1',
    'Quantumult X/1.0.30',
    'Surge/5.2.1'
];

subscriptions.post('/preview', async (c) => {
    const user = c.get('jwtPayload');
    const { url, subscription_id, apply_rules } = await c.req.json<{ url: string, subscription_id?: string, apply_rules?: boolean }>();
    
    if (!url) {
        return c.json({ success: false, message: 'Missing subscription URL' }, 400);
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
            },
        });

        if (!response.ok) {
            return c.json({ success: false, message: `Failed to fetch subscription: ${response.status} ${response.statusText}` }, 502);
        }

        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        let content = decoder.decode(buffer, { stream: true });

        // Remove BOM if present
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }

        let finalNodes = parseSubscriptionContent(content);

        if (apply_rules && subscription_id) {
            const { results: rules } = await c.env.DB.prepare(
                'SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? AND enabled = 1 ORDER BY id ASC'
            ).bind(subscription_id, user.id).all();

            if (rules && rules.length > 0) {
                finalNodes = applySubscriptionRules(finalNodes, rules);
            }
        }
        
        // Re-analyze nodes after applying rules
        const analysis = {
            total: finalNodes.length,
            protocols: finalNodes.reduce((acc, node) => {
                const protocol = node.protocol || 'unknown';
                acc[protocol] = (acc[protocol] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            regions: finalNodes.reduce((acc, node) => {
                // Basic region detection from name, can be improved
                const match = node.name.match(/\[(.*?)\]|\((.*?)\)|(香港|澳门|台湾|新加坡|日本|美国|英国|德国|法国|韩国|俄罗斯|IEPL|IPLC)/);
                const region = match ? (match[1] || match[2] || match[3] || 'Unknown') : 'Unknown';
                acc[region] = (acc[region] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
        };

        return c.json({ success: true, data: { nodes: finalNodes, analysis: analysis } });

    } catch (error: any) {
        console.error(`Error fetching/parsing subscription from ${url}:`, error);
        // Provide a more user-friendly message for network or fetch-related errors
        const errorMessage = error.cause?.message?.includes('ECONNRESET') || error.message?.includes('Network connection lost')
            ? '获取订阅超时或网络连接失败'
            : `处理订阅时出错: ${error.message}`;
        return c.json({ success: false, message: errorMessage }, 500);
    }
});

// Helper function to parse subscription content into a node list
const parseSubscriptionContent = (content: string): (ParsedNode & { id: string, raw: string })[] => {
    let nodes: (ParsedNode & { id: string, raw: string })[] = [];
    let isYaml = false;

    // 1. Try parsing as YAML
    try {
        if (content.includes('proxies:') || content.includes('proxy-groups:')) {
            const data = yaml.load(content) as any;
            if (data && Array.isArray(data.proxies)) {
                isYaml = true;
                nodes = data.proxies.map((proxy: any) => {
                    const protocol = proxy.type;
                    return {
                        id: crypto.randomUUID(),
                        name: proxy.name,
                        protocol: protocol,
                        server: proxy.server,
                        port: proxy.port,
                        type: protocol,
                        password: proxy.password || proxy.uuid,
                        protocol_params: proxy,
                        link: `clash://${protocol}/${proxy.name}`,
                        raw: `clash://${protocol}/${proxy.name}`,
                    };
                });
            }
        }
    } catch (e) {
        console.log("YAML parsing failed, trying as plain text.");
    }

    // 2. If not YAML, try parsing as base64 encoded list
    if (!isYaml) {
        try {
            const decodedContent = atob(content);
             if (decodedContent.includes('proxies:') || decodedContent.includes('proxy-groups:')) {
                 const data = yaml.load(decodedContent) as any;
                 if (data && Array.isArray(data.proxies)) {
                     isYaml = true;
                     nodes = data.proxies.map((proxy: any) => ({
                        id: crypto.randomUUID(),
                        name: proxy.name,
                        protocol: proxy.type,
                        server: proxy.server,
                        port: proxy.port,
                        type: proxy.type,
                        password: proxy.password || proxy.uuid,
                        protocol_params: proxy,
                        link: `clash://${proxy.type}/${proxy.name}`,
                        raw: `clash://${proxy.type}/${proxy.name}`,
                     }));
                 }
             } else {
                nodes = parseNodeLinks(decodedContent);
             }
        } catch (e) {
            nodes = parseNodeLinks(content);
        }
    }
    
    // 3. If still no nodes, treat as plain text list of links
    if (nodes.length === 0 && !isYaml) {
        nodes = parseNodeLinks(content);
    }

    return nodes;
};

// Helper function to get accurate node count from subscription content
const getAccurateNodeCount = (content: string): number => {
    try {
        const nodes = parseSubscriptionContent(content);
        return nodes.length;
    } catch (error) {
        console.error("Failed to get accurate node count:", error);
        return 0;
    }
};


subscriptions.post('/:id/update', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();

    const subscription = await c.env.DB.prepare('SELECT url FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ url: string }>();
    if (!subscription) {
        return c.json({ success: false, message: 'Subscription not found' }, 404);
    }

    try {
        const response = await fetch(subscription.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
        if (!response.ok) {
            const error = `Failed to fetch: ${response.statusText}`;
            await c.env.DB.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), error, id).run();
            return c.json({ success: false, message: error }, 502);
        }
        
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        let content = decoder.decode(buffer, { stream: true });
        if (content.charCodeAt(0) === 0xFEFF) { // Remove BOM
            content = content.slice(1);
        }

        const nodeCount = getAccurateNodeCount(content);
        const now = new Date().toISOString();

        await c.env.DB.prepare(
            'UPDATE subscriptions SET node_count = ?, last_updated = ?, error = NULL WHERE id = ?'
        ).bind(nodeCount, now, id).run();

        return c.json({ success: true, message: `Subscription updated successfully. Found ${nodeCount} nodes.` });
    } catch (error: any) {
        const errorMessage = `Update failed: ${error.message}`;
        await c.env.DB.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), errorMessage, id).run();
        return c.json({ success: false, message: errorMessage }, 500);
    }
});

subscriptions.get('/:id/rules', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const { results } = await c.env.DB.prepare('SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? ORDER BY id ASC').bind(id, user.id).all();
    return c.json({ success: true, data: results });
});

subscriptions.post('/:id/rules', async (c) => {
    const user = c.get('jwtPayload');
    const { id: subscription_id } = c.req.param();
    const body = await c.req.json<any>();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
        `INSERT INTO subscription_rules (subscription_id, user_id, name, type, value, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(subscription_id, user.id, body.name, body.type, body.value, body.enabled ? 1 : 0, now, now).run();

    return c.json({ success: true }, 201);
});

subscriptions.put('/:id/rules/:ruleId', async (c) => {
    const user = c.get('jwtPayload');
    const { ruleId } = c.req.param();
    const body = await c.req.json<any>();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
        `UPDATE subscription_rules
         SET name = ?, type = ?, value = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(body.name, body.type, body.value, body.enabled ? 1 : 0, now, ruleId, user.id).run();
    
    return c.json({ success: true });
});

subscriptions.delete('/:id/rules/:ruleId', async (c) => {
    const user = c.get('jwtPayload');
    const { ruleId } = c.req.param();

    await c.env.DB.prepare(
        'DELETE FROM subscription_rules WHERE id = ? AND user_id = ?'
    ).bind(ruleId, user.id).run();

    return c.json({ success: true });
});

subscriptions.put('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const body = await c.req.json<any>();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
        `UPDATE subscriptions SET name = ?, url = ?, type = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(
        body.name,
        body.url,
        body.type || 'plain', // Add default value for type
        body.enabled ?? 1,    // Add default value for enabled
        now,
        id,
        user.id
    ).run();
    return c.json({ success: true });
});

subscriptions.delete('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

app.route('/subscriptions', subscriptions);

// Profiles routes
const profiles = new Hono<{ Bindings: Env }>();
profiles.use('*', manualAuthMiddleware);

profiles.get('/', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).all<any>();
    
    // Expand the 'content' JSON field into the main object
    const expandedResults = results.map(profile => {
        try {
            const content = JSON.parse(profile.content || '{}');
            // Merge content properties, but let DB columns like id and name take precedence
            return { ...content, ...profile };
        } catch (e) {
            console.error(`Failed to parse content for profile ${profile.id}:`, e);
            // Return the profile as-is if content is invalid
            return profile;
        }
    });

    return c.json({ success: true, data: expandedResults });
});

profiles.post('/', async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<any>();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        return c.json({ success: false, message: 'Profile name is required.' }, 400);
    }

    // Ensure content is a string, default to an empty JSON object if not provided.
    const content = typeof body.content === 'string' ? body.content : '{}';

    // Validate client_type
    if (!body.client_type || typeof body.client_type !== 'string') {
        return c.json({ success: false, message: 'Client type is required.' }, 400);
    }

    await c.env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, client_type, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, body.name.trim(), body.client_type, content, now, now).run();
    return c.json({ success: true, data: { id } }, 201);
});

profiles.get('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!profile) return c.json({ success: false, message: 'Profile not found' }, 404);
    return c.json({ success: true, data: profile });
});

profiles.put('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const body = await c.req.json<any>();
    const now = new Date().toISOString();

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        return c.json({ success: false, message: 'Profile name is required.' }, 400);
    }
    
    const content = typeof body.content === 'string' ? body.content : '{}';

    // Validate client_type
    if (!body.client_type || typeof body.client_type !== 'string') {
        return c.json({ success: false, message: 'Client type is required.' }, 400);
    }

    await c.env.DB.prepare(
        `UPDATE profiles SET name = ?, client_type = ?, content = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(body.name.trim(), body.client_type, content, now, id, user.id).run();
    return c.json({ success: true });
});

profiles.delete('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

profiles.get('/:id/subscribe', async (c) => {
    // This is a public endpoint, no auth
    const { id } = c.req.param();
    const profile = await c.env.DB.prepare('SELECT content FROM profiles WHERE id = ?').bind(id).first<{ content: string }>();
    if (!profile) {
        return c.text('Profile not found', 404);
    }
    return c.text(profile.content);
});

app.route('/profiles', profiles);

// Other GET routes that were correct
app.get('/config-templates', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM config_templates WHERE user_id = ? OR is_system = 1').bind(user.id).all();
    return c.json({ success: true, data: results });
});

app.get('/admin/users', manualAuthMiddleware, async (c) => {
    const { results } = await c.env.DB.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE role != 'system'").all();
    return c.json({ success: true, data: results });
});

app.get('/admin/system-settings', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM system_settings').all();
    const settings = (results as any[]).reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
    }, {});
    return c.json({ success: true, data: settings });
});


// Subconverter Assets routes
// Subconverter Assets routes
app.get('/subconverter-assets', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare("SELECT * FROM subconverter_assets WHERE user_id = ? OR user_id = 'system-user-001'").bind(user.id).all();
    return c.json({ success: true, data: results });
});

app.post('/subconverter-assets', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<{ name: string; url: string; type: 'backend' | 'config' }>();
    const now = new Date().toISOString();

    if (!body.name || !body.url || !body.type) {
        return c.json({ success: false, message: 'Missing required fields' }, 400);
    }

    const { meta } = await c.env.DB.prepare(
        `INSERT INTO subconverter_assets (user_id, name, url, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, body.name, body.url, body.type, now, now).run();

    return c.json({ success: true, data: { id: meta.last_row_id } }, 201);
});

app.put('/subconverter-assets/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const body = await c.req.json<{ name: string; url: string }>();
    const now = new Date().toISOString();

    if (!body.name || !body.url) {
        return c.json({ success: false, message: 'Missing required fields' }, 400);
    }

    let query;
    if (user.role === 'admin') {
        // Admin can update any asset
        query = c.env.DB.prepare(
            `UPDATE subconverter_assets
             SET name = ?, url = ?, updated_at = ?
             WHERE id = ?`
        ).bind(body.name, body.url, now, id);
    } else {
        // Regular user can only update their own assets
        query = c.env.DB.prepare(
            `UPDATE subconverter_assets
             SET name = ?, url = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).bind(body.name, body.url, now, id, user.id);
    }

    const { meta } = await query.run();

    if (meta.changes === 0) {
        return c.json({ success: false, message: 'Asset not found or user does not have permission' }, 404);
    }

    return c.json({ success: true });
});

app.delete('/subconverter-assets/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();

    let query;
    if (user.role === 'admin') {
        // Admin can delete any asset
        query = c.env.DB.prepare(
            'DELETE FROM subconverter_assets WHERE id = ?'
        ).bind(id);
    } else {
        // Regular user can only delete their own assets
        query = c.env.DB.prepare(
            'DELETE FROM subconverter_assets WHERE id = ? AND user_id = ?'
        ).bind(id, user.id);
    }

    const { meta } = await query.run();

    if (meta.changes === 0) {
        return c.json({ success: false, message: 'Asset not found or user does not have permission' }, 404);
    }

    return c.json({ success: true });
});

app.get('/settings', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM settings WHERE user_id = ?').bind(user.id).all();
    return c.json({ success: true, data: results });
});

export const onRequest = handle(app);
