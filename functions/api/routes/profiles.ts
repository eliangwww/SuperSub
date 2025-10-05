import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';
import { parseNodeLinks, ParsedNode } from '../../../src/utils/nodeParser';
import { applySubscriptionRules, parseSubscriptionContent, userAgents } from './subscriptions'; // Assuming these are exported from subscriptions.ts

const profiles = new Hono<{ Bindings: Env }>();

// This is a public endpoint, no auth on this specific route
profiles.get('/:id/subscribe', async (c) => {
    const { id } = c.req.param();
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first<any>();

    if (!profile) {
        return c.text('Profile not found', 404);
    }

    try {
        const content = JSON.parse(profile.content || '{}');
        const userId = profile.user_id;

        let allNodes: (ParsedNode & { id: string; raw: string; })[] = [];

        // 1. Fetch nodes from subscriptions
        if (content.subscription_ids && content.subscription_ids.length > 0) {
            const subIds = content.subscription_ids.join(',');
            const { results: subscriptions } = await c.env.DB.prepare(`SELECT id, url FROM subscriptions WHERE id IN (${'?,'.repeat(content.subscription_ids.length).slice(0, -1)}) AND user_id = ?`).bind(...content.subscription_ids, userId).all<{ id: string; url: string; }>();

            for (const sub of subscriptions) {
                try {
                    const response = await fetch(sub.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
                    if (response.ok) {
                        const subContent = await response.text();
                        let nodes = parseSubscriptionContent(subContent);

                        // Apply rules for this specific subscription
                        const { results: rules } = await c.env.DB.prepare('SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? AND enabled = 1 ORDER BY sort_order ASC').bind(sub.id, userId).all();
                        if (rules && rules.length > 0) {
                            nodes = applySubscriptionRules(nodes, rules);
                        }
                        allNodes.push(...nodes);
                    }
                } catch (e) {
                    console.error(`Failed to process subscription ${sub.id}:`, e);
                }
            }
        }

        // 2. Fetch manually added nodes
        if (content.nodeIds && content.nodeIds.length > 0) {
            const nodeIds = content.nodeIds.join(',');
            const { results: manualNodes } = await c.env.DB.prepare(`SELECT * FROM nodes WHERE id IN (${'?,'.repeat(content.nodeIds.length).slice(0, -1)}) AND user_id = ?`).bind(...content.nodeIds, userId).all<any>();
            
            const parsedManualNodes = manualNodes.map(n => ({
                id: n.id,
                name: n.name,
                protocol: n.protocol,
                server: n.server,
                port: n.port,
                protocol_params: JSON.parse(n.protocol_params || '{}'),
                link: n.link,
                raw: n.link,
            }));
            allNodes.push(...parsedManualNodes);
        }

        if (allNodes.length === 0) {
            return c.text('No nodes found for this profile.', 404);
        }

        // 3. Generate final config
        if (content.generation_mode === 'online') {
            const backend = await c.env.DB.prepare("SELECT url FROM subconverter_assets WHERE id = ?").bind(content.subconverter_backend_id).first<{ url: string }>();
            const config = await c.env.DB.prepare("SELECT url FROM subconverter_assets WHERE id = ?").bind(content.subconverter_config_id).first<{ url: string }>();

            if (!backend || !config) {
                return c.text('Subconverter backend or config not found.', 500);
            }

            // Convert nodes to a format subconverter can understand (e.g., base64 encoded list of links)
            const nodeLinks = allNodes.map(n => n.link || n.raw).filter(Boolean).join('\n');
            const encodedNodes = btoa(nodeLinks);

            const targetUrl = new URL(`${backend.url}/sub`);
            targetUrl.searchParams.set('target', 'clash'); // Target is now determined by the config, but we set a default
            targetUrl.searchParams.set('url', `data:text/plain;base64,${encodedNodes}`);
            targetUrl.searchParams.set('config', config.url);

            const subResponse = await fetch(targetUrl.toString(), { headers: { 'User-Agent': 'Clash' } });
            if (!subResponse.ok) {
                return c.text(`Failed to generate from subconverter: ${await subResponse.text()}`, 502);
            }
            const finalConfig = await subResponse.text();
            return c.text(finalConfig);

        } else {
            // Local generation (currently placeholder)
            return c.text(JSON.stringify(allNodes, null, 2));
        }

    } catch (e: any) {
        console.error(`Error generating profile ${id}:`, e);
        return c.text(`Internal server error: ${e.message}`, 500);
    }
});


// All other routes in this group require auth
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

    await c.env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, body.name.trim(), content, now, now).run();
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

    await c.env.DB.prepare(
        `UPDATE profiles SET name = ?, content = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).bind(body.name.trim(), content, now, id, user.id).run();
    return c.json({ success: true });
});

profiles.delete('/:id', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

export default profiles;