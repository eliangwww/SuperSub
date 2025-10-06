import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';
import { parseNodeLinks, ParsedNode } from '../../../src/utils/nodeParser';
import { applySubscriptionRules, parseSubscriptionContent, userAgents } from './subscriptions';

const profiles = new Hono<{ Bindings: Env }>();

// This is a public endpoint, no auth on this specific route
profiles.get('/:identifier/subscribe', async (c) => {
    c.status(410); // Gone
    return c.text('This subscription link format is deprecated. Please use the new format: /s/{token}/{alias}/subscribe');
});


// All other routes below this line require auth
profiles.use('*', manualAuthMiddleware);

profiles.get('/:id/preview-nodes', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).first<any>();

    if (!profile) {
        return c.json({ success: false, message: 'Profile not found' }, 404);
    }

    try {
        const content = JSON.parse(profile.content || '{}');
        const userId = profile.user_id;

        let allNodes: (ParsedNode & { id: string; raw: string; subscriptionName?: string; isManual?: boolean; group_name?: string; })[] = [];

        if (content.subscription_ids && content.subscription_ids.length > 0) {
            const subPlaceholders = content.subscription_ids.map(() => '?').join(',');
            const { results: subscriptions } = await c.env.DB.prepare(`SELECT id, name, url FROM subscriptions WHERE id IN (${subPlaceholders}) AND user_id = ?`).bind(...content.subscription_ids, userId).all<{ id: string; name: string; url: string; }>();

            for (const sub of subscriptions) {
                try {
                    const response = await fetch(sub.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
                    if (response.ok) {
                        const subContent = await response.text();
                        let nodes = parseSubscriptionContent(subContent);

                        const { results: rules } = await c.env.DB.prepare('SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? AND enabled = 1 ORDER BY sort_order ASC').bind(sub.id, userId).all();
                        if (rules && rules.length > 0) {
                            nodes = applySubscriptionRules(nodes, rules);
                        }
                        const nodesWithSubName = nodes.map(node => ({ ...node, subscriptionName: sub.name }));
                        allNodes.push(...nodesWithSubName);
                    }
                } catch (e) {
                    // console.error(`Failed to process subscription ${sub.id}:`, e);
                }
            }
        }

        if (content.node_ids && content.node_ids.length > 0) {
            const nodePlaceholders = content.node_ids.map(() => '?').join(',');
            const manualNodesQuery = `
                SELECT n.*, g.name as group_name
                FROM nodes n
                LEFT JOIN node_groups g ON n.group_id = g.id
                WHERE n.id IN (${nodePlaceholders}) AND n.user_id = ?
            `;
            const { results: manualNodes } = await c.env.DB.prepare(manualNodesQuery).bind(...content.node_ids, userId).all<any>();
            
            const parsedManualNodes = manualNodes.map(n => ({
                id: n.id,
                name: n.name,
                protocol: n.protocol,
                server: n.server,
                port: n.port,
                protocol_params: JSON.parse(n.protocol_params || '{}'),
                link: n.link,
                raw: n.link,
                group_name: n.group_name, // Keep group name for prefixing
            }));

            const taggedManualNodes = parsedManualNodes.map(node => ({ ...node, isManual: true }));
            allNodes.push(...taggedManualNodes);
        }

        const prefixSettings = content.node_prefix_settings || {};
        if (prefixSettings.enable_subscription_prefix || prefixSettings.manual_node_prefix || prefixSettings.enable_group_name_prefix) {
            allNodes = allNodes.map(node => {
                // Subscription prefix logic (unchanged)
                if (prefixSettings.enable_subscription_prefix && node.subscriptionName) {
                    return { ...node, name: `${node.subscriptionName} - ${node.name}` };
                }

                // Manual node prefixing logic (new priority)
                if (node.isManual) {
                    if (prefixSettings.enable_group_name_prefix && node.group_name) {
                        return { ...node, name: `${node.group_name} - ${node.name}` };
                    }
                    if (prefixSettings.manual_node_prefix) {
                        return { ...node, name: `${prefixSettings.manual_node_prefix} - ${node.name}` };
                    }
                }
                
                return node;
            });
        }
        
        const analysis = {
            total: allNodes.length,
            protocols: allNodes.reduce((acc, node) => {
                const protocol = node.protocol || 'unknown';
                acc[protocol] = (acc[protocol] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            regions: allNodes.reduce((acc, node) => {
                const match = node.name.match(/\[(.*?)\]|\((.*?)\)|(香港|澳门|台湾|新加坡|日本|美国|英国|德国|法国|韩国|俄罗斯|IEPL|IPLC)/);
                const region = match ? (match[1] || match[2] || match[3] || 'Unknown') : 'Unknown';
                acc[region] = (acc[region] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
        };

        return c.json({ success: true, data: { nodes: allNodes, analysis: analysis } });

    } catch (e: any) {
        // console.error(`Error generating profile preview for ${id}:`, e);
        return c.json({ success: false, message: `Internal server error: ${e.message}` }, 500);
    }
});

profiles.get('/', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).all<any>();
    
    const expandedResults = results.map(profile => {
        try {
            const content = JSON.parse(profile.content || '{}');
            return { ...content, ...profile };
        } catch (e) {
            console.error(`Failed to parse content for profile ${profile.id}:`, e);
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

    // Explicitly separate top-level fields from content fields
    const name = body.name.trim();
    const alias = body.alias || null;
    const content = JSON.parse(body.content || '{}');

    // Rebuild a clean content payload, excluding any top-level fields
    const contentPayload = {
        subscription_ids: content.subscription_ids,
        node_ids: content.node_ids,
        node_prefix_settings: content.node_prefix_settings,
        subconverter_backend_id: content.subconverter_backend_id,
        subconverter_config_id: content.subconverter_config_id,
        generation_mode: 'online',
    };

    await c.env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, alias, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, name, alias, JSON.stringify(contentPayload), now, now).run();
    
    return c.json({ success: true, data: { id } }, 201);
});

profiles.get('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const profile: any = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!profile) return c.json({ success: false, message: 'Profile not found' }, 404);

    try {
        const content = JSON.parse(profile.content || '{}');
        const expandedProfile = { ...content, ...profile };
        return c.json({ success: true, data: expandedProfile });
    } catch (e) {
        console.error(`Failed to parse content for profile ${id}:`, e);
        return c.json({ success: true, data: profile });
    }
});

profiles.put('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    const body = await c.req.json<any>();
    const now = new Date().toISOString();

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        return c.json({ success: false, message: 'Profile name is required.' }, 400);
    }

    // Explicitly separate top-level fields from content fields
    const name = body.name.trim();
    const alias = body.alias || null;
    const content = JSON.parse(body.content || '{}');

    // Rebuild a clean content payload, excluding any top-level fields
    const contentPayload = {
        subscription_ids: content.subscription_ids,
        node_ids: content.node_ids,
        node_prefix_settings: content.node_prefix_settings,
        subconverter_backend_id: content.subconverter_backend_id,
        subconverter_config_id: content.subconverter_config_id,
        generation_mode: 'online',
    };

    await c.env.DB.prepare(
        `UPDATE profiles SET name = ?, alias = ?, content = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(name, alias, JSON.stringify(contentPayload), now, id, user.id).run();
    
    return c.json({ success: true });
});

profiles.delete('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

// All other routes below this line require auth

export default profiles;