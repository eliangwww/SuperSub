import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';
import { parseNodeLinks, ParsedNode } from '../../../src/utils/nodeParser';

const nodes = new Hono<{ Bindings: Env }>();

nodes.get('/grouped', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    
    const [nodesResponse, groupsResponse] = await Promise.all([
        c.env.DB.prepare('SELECT id, name, group_id FROM nodes WHERE user_id = ? ORDER BY name ASC').bind(user.id).all<{ id: string; name: string; group_id: string | null }>(),
        c.env.DB.prepare('SELECT id, name FROM node_groups WHERE user_id = ? ORDER BY sort_order ASC').bind(user.id).all<{ id: string; name: string }>()
    ]);

    const allNodes = nodesResponse.results;
    const allGroups = groupsResponse.results;

    const groupMap = new Map<string, string>();
    for (const group of allGroups) {
        groupMap.set(group.id, group.name);
    }

    const groupedNodes: { [key: string]: { id: string; name: string }[] } = {};
    const ungroupedNodes: { id: string; name: string }[] = [];

    for (const group of allGroups) {
        groupedNodes[group.name] = [];
    }

    for (const node of allNodes) {
        if (node.group_id && groupMap.has(node.group_id)) {
            const groupName = groupMap.get(node.group_id)!;
            groupedNodes[groupName].push({ id: node.id, name: node.name });
        } else {
            ungroupedNodes.push({ id: node.id, name: node.name });
        }
    }

    const responseData = {
        ...groupedNodes,
        ...(ungroupedNodes.length > 0 ? { '未分组': ungroupedNodes } : {})
    };

    return c.json({ success: true, data: responseData });
});

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

nodes.post('/batch-import', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<{ links?: string; nodes?: ParsedNode[]; groupId?: string }>();

    let nodesToImport: ParsedNode[] = [];

    if (body.nodes && Array.isArray(body.nodes)) {
        nodesToImport = body.nodes;
    } else if (body.links) {
        nodesToImport = parseNodeLinks(body.links);
    }

    if (nodesToImport.length === 0) {
        return c.json({ success: false, message: 'No valid nodes to import' }, 400);
    }

    const now = new Date().toISOString();
    const groupId = body.groupId || null;

    const stmts = nodesToImport.map(node => {
        const id = crypto.randomUUID();
        const protocol = node.protocol || 'unknown';
        const name = node.name || 'Unknown Node';
        const server = node.server || '';
        const port = node.port || 0;
        const link = node.link || node.raw || '';

        return c.env.DB.prepare(
            `INSERT INTO nodes (id, user_id, group_id, name, link, protocol, protocol_params, server, port, type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, groupId, name, link, protocol, JSON.stringify(node.protocol_params || {}), server, port, protocol, now, now);
    });

    if (stmts.length > 0) {
        await c.env.DB.batch(stmts);
    }

    return c.json({ success: true, message: `Successfully imported ${stmts.length} nodes.` });
});

nodes.post('/batch-update-group', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const body = await c.req.json<{ nodeIds?: string[]; groupId?: string | null }>();

    if (!body.nodeIds || body.nodeIds.length === 0) {
        return c.json({ success: false, message: 'No nodes selected' }, 400);
    }

    const now = new Date().toISOString();
    const groupId = body.groupId || null;

    // D1's `in` operator doesn't work well with `?` binding for arrays.
    // We need to create the placeholders manually.
    const placeholders = body.nodeIds.map(() => '?').join(',');

    await c.env.DB.prepare(
        `UPDATE nodes
         SET group_id = ?, updated_at = ?
         WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(groupId, now, ...body.nodeIds, user.id).run();

    return c.json({ success: true, message: 'Nodes moved successfully' });
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
            body.name,
            body.link,
            parsedNode.protocol,
            JSON.stringify(parsedNode.protocol_params),
            parsedNode.server,
            parsedNode.port,
            parsedNode.protocol,
            now,
            id,
            user.id
        ).run();
    } else {
        await c.env.DB.prepare(
            `UPDATE nodes SET name = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).bind(body.name, now, id, user.id).run();
    }

    return c.json({ success: true });
});

nodes.delete('/:id', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ success: true });
});

export default nodes;