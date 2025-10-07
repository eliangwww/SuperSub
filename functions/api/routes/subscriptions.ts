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
            const parsedValue = parseInt(value, 10);
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

// Helper to extract info from content using regex
const extractInfoFromContent = (content: string): { expire: number | null } => {
    // Regex for remaining days or specific expiry date
    const expireRegex = /(?:剩余天数|可用天数|Expire(?:s|d)?\s*(?:in|on)?)\s*[:：]?\s*(\d+)|(?:到期时间|过期时间)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/;
    const match = content.match(expireRegex);

    if (match) {
        if (match[1]) { // Matched remaining days
            const days = parseInt(match[1], 10);
            return { expire: Math.floor((Date.now() / 1000) + (days * 86400)) };
        }
        if (match[2]) { // Matched a specific date
            return { expire: Math.floor(new Date(match[2]).getTime() / 1000) };
        }
    }
    return { expire: null };
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
                const userInfoHeader = response.headers.get('subscription-userinfo');
                let subscriptionInfo = null;
                let expiresAt: string | null = null;

                if (userInfoHeader) {
                    subscriptionInfo = userInfoHeader;
                    const info = parseSubscriptionInfo(userInfoHeader);
                    if (info.expire) {
                        // Assuming expire is a Unix timestamp in seconds
                        expiresAt = new Date(info.expire * 1000).toISOString();
                    }
                }

                const buffer = await response.arrayBuffer();
                const decoder = new TextDecoder('utf-8');
                let content = decoder.decode(buffer, { stream: true });
                if (content.charCodeAt(0) === 0xFEFF) { // Remove BOM
                    content = content.slice(1);
                }

                // If no expire info from header, try to find it in content
                if (!expiresAt) {
                    const infoFromContent = extractInfoFromContent(content);
                    if (infoFromContent.expire) {
                        expiresAt = new Date(infoFromContent.expire * 1000).toISOString();
                    }
                }
                
                const nodeCount = getAccurateNodeCount(content);
                const now = new Date().toISOString();
                await c.env.DB.prepare(
                    'UPDATE subscriptions SET node_count = ?, last_updated = ?, error = NULL, expires_at = ?, subscription_info = ? WHERE id = ?'
                ).bind(nodeCount, now, expiresAt, subscriptionInfo, sub.id).run();
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

    const subscription = await c.env.DB.prepare('SELECT url FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ url: string }>();
    if (!subscription) {
        return c.json({ success: false, message: 'Subscription not found' }, 404);
    }

    try {
        const response = await fetch(subscription.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
        if (!response.ok) {
            const error = `Failed to fetch: ${response.status} ${response.statusText}`;
            await c.env.DB.prepare('UPDATE subscriptions SET last_updated = ?, error = ? WHERE id = ?').bind(new Date().toISOString(), error, id).run();
            return c.json({ success: false, message: error }, 502);
        }
        
        const userInfoHeader = response.headers.get('subscription-userinfo');
        let subscriptionInfo = null;
        let expiresAt: string | null = null;

        if (userInfoHeader) {
            subscriptionInfo = userInfoHeader;
            const info = parseSubscriptionInfo(userInfoHeader);
            if (info.expire) {
                // Assuming expire is a Unix timestamp in seconds
                expiresAt = new Date(info.expire * 1000).toISOString();
            }
        }

        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        let content = decoder.decode(buffer, { stream: true });
        if (content.charCodeAt(0) === 0xFEFF) { // Remove BOM
            content = content.slice(1);
        }

        // If no expire info from header, try to find it in content
        if (!expiresAt) {
            const infoFromContent = extractInfoFromContent(content);
            if (infoFromContent.expire) {
                expiresAt = new Date(infoFromContent.expire * 1000).toISOString();
            }
        }

        const nodeCount = getAccurateNodeCount(content);
        const now = new Date().toISOString();

        await c.env.DB.prepare(
            'UPDATE subscriptions SET node_count = ?, last_updated = ?, error = NULL, expires_at = ?, subscription_info = ? WHERE id = ?'
        ).bind(nodeCount, now, expiresAt, subscriptionInfo, id).run();

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