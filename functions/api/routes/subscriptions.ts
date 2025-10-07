import { Hono } from 'hono';
import * as yaml from 'js-yaml';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';
import { parseNodeLinks, ParsedNode } from '../../../src/utils/nodeParser';

const subscriptions = new Hono<{ Bindings: Env }>();
subscriptions.use('*', manualAuthMiddleware);

export const userAgents = [
    'V2RayN/7.23',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'clash-verge/v2.2.3',
];

// Helper function to parse subscription content into a node list
export const parseSubscriptionContent = (content: string): (ParsedNode & { id: string, raw: string })[] => {
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

// Helper function to apply rules to a list of nodes
export const applySubscriptionRules = (nodes: (ParsedNode & { id: string; raw: string; })[], rules: any[]): (ParsedNode & { id: string; raw: string; })[] => {
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


// Helper to parse 'subscription-userinfo' header
const parseSubscriptionInfo = (userInfo: string): { upload: number; download: number; total: number; expire: number | null } => {
    const info: any = {};
    userInfo.split(';').forEach(part => {
        const [key, value] = part.split('=').map(s => s.trim());
        if (key && value) {
            // Use parseFloat to handle potential non-integer values, though spec is integer bytes
            const parsedValue = parseFloat(value);
            info[key] = isNaN(parsedValue) ? 0 : parsedValue;
        }
    });
    return {
        upload: info.upload || 0,
        download: info.download || 0,
        total: info.total || 0,
        expire: info.expire || null,
    };
};

const sizeToBytes = (sizeStr: string): number => {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.]+)\s*(TB|GB|MB|KB|T|G|M|K)?/i);
    if (!match) return 0;

    const size = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();

    switch (unit) {
        case 'TB': case 'T': return size * Math.pow(1024, 4);
        case 'GB': case 'G': return size * Math.pow(1024, 3);
        case 'MB': case 'M': return size * Math.pow(1024, 2);
        case 'KB': case 'K': return size * 1024;
        default: return size;
    }
};

const bytesToSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};


// Final, simplified, and correct approach.
const extractInfoFromNodeNames = (nodeNames: string[]): { upload: number; download: number; total: number; expire: number | null } => {
    const text = nodeNames.join(' '); // Combine all node names into a single string
    const result = { upload: 0, download: 0, total: 0, expire: null as number | null };

    // --- Simplified Data Usage Extraction ---
    const remainingMatch = text.match(/剩余流量[\:：]([\d.]+\s*[TGMK]B?)/i);
    if (remainingMatch) {
        const remainingBytes = sizeToBytes(remainingMatch[1]);
        // When only "remaining" is available, we can treat it as the total available from this point.
        result.total = remainingBytes;
        result.download = 0;
        result.upload = 0;
    }

    // --- Simplified Expiry Info Extraction ---
    const expiryDateMatch = text.match(/套餐到期[\:：](\d{4}-\d{2}-\d{2})/i);
    if (expiryDateMatch) {
        const date = new Date(expiryDateMatch[1]);
        if (!isNaN(date.getTime())) {
            result.expire = Math.floor(date.getTime() / 1000);
        }
    }

    const remainingDaysMatch = text.match(/(?:距离下次重置剩余|剩余|可用)[\:：](\d+)\s*天/i);
    if (remainingDaysMatch && !result.expire) { // Avoid overwriting a specific date
        const days = parseInt(remainingDaysMatch[1], 10);
        if (!isNaN(days)) {
            result.expire = Math.floor((Date.now() / 1000) + (days * 86400));
        }
    }
    
    return result;
};


subscriptions.get('/', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
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
        `INSERT INTO subscriptions (id, user_id, name, url, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        user.id,
        body.name,
        body.url,
        now,
        now
    ).run();
    return c.json({ success: true, data: { id } }, 201);
});

subscriptions.post('/batch-import', async (c) => {
    const user = c.get('jwtPayload');
    const { subscriptions: subs, groupId } = await c.req.json<{ subscriptions: any[], groupId?: string }>();

    if (!Array.isArray(subs) || subs.length === 0) {
        return c.json({ success: false, message: 'No subscriptions to import' }, 400);
    }

    const now = new Date().toISOString();
    const stmts = subs.map(sub => {
        const id = crypto.randomUUID();
        return c.env.DB.prepare(
            `INSERT INTO subscriptions (id, user_id, name, url, group_id, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, sub.name, sub.url, groupId || null, now, now);
    });

    await c.env.DB.batch(stmts);

    return c.json({ success: true, data: { message: `Successfully imported ${subs.length} subscriptions.` } });
});

// This function will be called by both individual and batch updates.
const updateSingleSubscription = async (db: D1Database, sub: { id: string; url: string }): Promise<{ success: boolean; data?: any; error?: string }> => {
    try {
        const response = await fetch(sub.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
        if (!response.ok) {
            const error = `Failed to fetch: ${response.status} ${response.statusText}`;
            await db.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), error, sub.id).run();
            return { success: false, error };
        }

        const userInfoHeader = response.headers.get('subscription-userinfo');
        const rawContent = await response.text();

        // The correct, final logic:
        // 1. Parse content into structured nodes, this handles all formats (YAML, Base64, etc.)
        const nodes = parseSubscriptionContent(rawContent);
        const nodeCount = nodes.length;

        // 2. Extract info from the names of the parsed nodes.
        const infoFromNodes = extractInfoFromNodeNames(nodes.map(n => n.name));
        
        // 3. Get header info as a fallback.
        let headerInfo: { upload: number; download: number; total: number; expire: number | null } = { upload: 0, download: 0, total: 0, expire: null };
        if (userInfoHeader) {
            headerInfo = parseSubscriptionInfo(userInfoHeader);
        }

        // 4. Combine, giving node-extracted info priority.
        const finalInfo = {
            upload: infoFromNodes.upload > 0 ? infoFromNodes.upload : headerInfo.upload,
            download: infoFromNodes.download > 0 ? infoFromNodes.download : headerInfo.download,
            total: infoFromNodes.total > 0 ? infoFromNodes.total : headerInfo.total,
            expire: infoFromNodes.expire ? infoFromNodes.expire : headerInfo.expire,
        };

        const subscriptionInfoString = `upload=${finalInfo.upload};download=${finalInfo.download};total=${finalInfo.total}`;
        const expiresAt = finalInfo.expire ? new Date(finalInfo.expire * 1000).toISOString() : null;
        
        const now = new Date().toISOString();

        await db.prepare(
            'UPDATE subscriptions SET node_count = ?, last_updated = ?, error = NULL, expires_at = ?, subscription_info = ? WHERE id = ?'
        ).bind(nodeCount, now, expiresAt, subscriptionInfoString, sub.id).run();

        const updatedSub = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(sub.id).first();

        return { success: true, data: updatedSub };

    } catch (error: any) {
        const errorMessage = `Update failed: ${error.message}`;
        await db.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), errorMessage, sub.id).run();
        return { success: false, error: errorMessage };
    }
};


subscriptions.post('/update-all', async (c) => {
    const user = c.get('jwtPayload');
    const { results: subs } = await c.env.DB.prepare(
        'SELECT id, url FROM subscriptions WHERE user_id = ? AND enabled = 1'
    ).bind(user.id).all<{ id: string; url: string }>();

    if (!subs || subs.length === 0) {
        return c.json({ success: true, message: 'No enabled subscriptions to update.' });
    }

    const CONCURRENCY_LIMIT = 5;
    let updatedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < subs.length; i += CONCURRENCY_LIMIT) {
        const chunk = subs.slice(i, i + CONCURRENCY_LIMIT);
        const promises = chunk.map(sub => updateSingleSubscription(c.env.DB, sub));
        
        const results = await Promise.all(promises);

        for (const result of results) {
            if (result.success) {
                updatedCount++;
            } else {
                failedCount++;
            }
        }
    }

    return c.json({ success: true, message: `Update complete. ${updatedCount} succeeded, ${failedCount} failed.` });
});

subscriptions.post('/preview', async (c) => {
    const user = c.get('jwtPayload');
    const { url, subscription_id, apply_rules } = await c.req.json<{ url: string, subscription_id?: string, apply_rules?: boolean }>();
    
    if (!url) {
        return c.json({ success: false, message: 'Missing subscription URL' }, 400);
    }

    try {
        console.log(`[PREVIEW] Starting preview for URL: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'clash-verge',
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
                'SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? AND enabled = 1 ORDER BY sort_order ASC'
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

subscriptions.post('/:id/update', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();

    const subscription = await c.env.DB.prepare('SELECT id, url FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ id: string, url: string }>();
    if (!subscription) {
        return c.json({ success: false, message: 'Subscription not found' }, 404);
    }

    const result = await updateSingleSubscription(c.env.DB, subscription);

    if (result.success) {
        return c.json({ success: true, message: `Subscription updated successfully.`, data: result.data });
    } else {
        return c.json({ success: false, message: result.error }, 500);
    }
});

subscriptions.get('/:id/rules', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const { results } = await c.env.DB.prepare('SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? ORDER BY sort_order ASC').bind(id, user.id).all();
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

    // Check if only 'enabled' or 'sort_order' is being updated for a lighter update
    if (typeof body.enabled !== 'undefined' && Object.keys(body).length === 1) {
        await c.env.DB.prepare(
            `UPDATE subscription_rules SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).bind(body.enabled ? 1 : 0, now, ruleId, user.id).run();
    } else if (typeof body.sort_order !== 'undefined' && Object.keys(body).length === 1) {
        await c.env.DB.prepare(
            `UPDATE subscription_rules SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).bind(body.sort_order, now, ruleId, user.id).run();
    } else {
        await c.env.DB.prepare(
            `UPDATE subscription_rules
             SET name = ?, type = ?, value = ?, enabled = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).bind(body.name, body.type, body.value, body.enabled ? 1 : 0, now, ruleId, user.id).run();
    }
    
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
        `UPDATE subscriptions SET name = ?, url = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(
        body.name,
        body.url,
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

subscriptions.post('/batch-delete', async (c) => {
    const user = c.get('jwtPayload');
    const { ids } = await c.req.json<{ ids: string[] }>();

    if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ success: false, message: 'No subscription IDs provided' }, 400);
    }

    const placeholders = ids.map(() => '?').join(',');
    const query = `DELETE FROM subscriptions WHERE user_id = ? AND id IN (${placeholders})`;
    
    const bindings = [user.id, ...ids];
    
    await c.env.DB.prepare(query).bind(...bindings).run();

    return c.json({ success: true, message: `Successfully deleted ${ids.length} subscriptions.` });
});


subscriptions.post('/batch-update-group', async (c) => {
    const user = c.get('jwtPayload');
    const { subscriptionIds, groupId } = await c.req.json<{ subscriptionIds: string[], groupId: string | null }>();

    if (!Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
        return c.json({ success: false, message: 'No subscription IDs provided' }, 400);
    }

    const placeholders = subscriptionIds.map(() => '?').join(',');
    const query = `UPDATE subscriptions SET group_id = ? WHERE user_id = ? AND id IN (${placeholders})`;
    
    const bindings = [groupId, user.id, ...subscriptionIds];
    
    await c.env.DB.prepare(query).bind(...bindings).run();

    return c.json({ success: true, message: 'Subscriptions moved successfully.' });
});

export default subscriptions;