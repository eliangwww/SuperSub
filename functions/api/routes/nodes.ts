import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';
import { parseNodeLinks, ParsedNode } from '../../../src/utils/nodeParser';

const nodes = new Hono<{ Bindings: Env }>();

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

nodes.post('/batch-update-group', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { nodeIds, groupId } = await c.req.json<{ nodeIds: string[]; groupId: string | null }>();

    if (!nodeIds || nodeIds.length === 0) {
        return c.json({ success: false, message: '请至少选择一个节点' }, 400);
    }

    const stmts = nodeIds.map(id =>
        c.env.DB.prepare('UPDATE nodes SET group_id = ? WHERE id = ? AND user_id = ?').bind(groupId, id, user.id)
    );

    await c.env.DB.batch(stmts);

    return c.json({ success: true, message: '节点分组已更新' });
});

nodes.post('/batch-actions', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { action, groupId } = await c.req.json<{ action: 'sort' | 'deduplicate' | 'clear', groupId: string }>();

    let whereClause = 'user_id = ?';
    const params: (string | null)[] = [user.id];

    if (groupId === 'ungrouped') {
        whereClause += ' AND group_id IS NULL';
    } else if (groupId !== 'all') {
        whereClause += ' AND group_id = ?';
        params.push(groupId);
    }

    try {
        if (action === 'clear') {
            const { meta } = await c.env.DB.prepare(`DELETE FROM nodes WHERE ${whereClause}`).bind(...params).run();
            return c.json({ success: true, message: `成功清空 ${meta.changes || 0} 个节点。` });
        }

        if (action === 'deduplicate') {
            const { results: nodesToDedupe } = await c.env.DB.prepare(`SELECT id, link FROM nodes WHERE ${whereClause}`).bind(...params).all<{ id: string, link: string }>();
            
            const seenLinks = new Set<string>();
            const duplicateIds: string[] = [];
            
            for (const node of nodesToDedupe) {
                if (seenLinks.has(node.link)) {
                    duplicateIds.push(node.id);
                } else {
                    seenLinks.add(node.link);
                }
            }

            if (duplicateIds.length > 0) {
                const deleteStmts = duplicateIds.map(id => c.env.DB.prepare('DELETE FROM nodes WHERE id = ? AND user_id = ?').bind(id, user.id));
                await c.env.DB.batch(deleteStmts);
                return c.json({ success: true, message: `成功移除 ${duplicateIds.length} 个重复节点。` });
            } else {
                return c.json({ success: true, message: '没有发现重复节点。' });
            }
        }

        if (action === 'sort') {
            const { results: nodesToSort } = await c.env.DB.prepare(`SELECT id, name FROM nodes WHERE ${whereClause}`).bind(...params).all<{ id: string, name: string }>();
            
            nodesToSort.sort((a, b) => a.name.localeCompare(b.name));
            
            const sortedIds = nodesToSort.map(n => n.id);

            // We need to fetch all nodes to preserve the order of other groups
            const { results: allUserNodes } = await c.env.DB.prepare('SELECT id, group_id FROM nodes WHERE user_id = ? ORDER BY sort_order ASC').bind(user.id).all<{ id: string, group_id: string | null }>();

            const groupNodes = sortedIds;
            const otherNodes = allUserNodes.filter(n => !groupNodes.includes(n.id)).map(n => n.id);
            
            const finalOrderedIds = [...otherNodes, ...groupNodes];
            
            // Let's re-order based on the new full list
            const finalStmts = finalOrderedIds.map((id, index) =>
                c.env.DB.prepare('UPDATE nodes SET sort_order = ? WHERE id = ? AND user_id = ?').bind(index, id, user.id)
            );

            if (finalStmts.length > 0) {
                await c.env.DB.batch(finalStmts);
            }

            return c.json({ success: true, message: '节点已按名称排序。' });
        }

        return c.json({ success: false, message: '无效的操作' }, 400);

    } catch (error: any) {
        console.error(`Batch action '${action}' failed for group '${groupId}':`, error);
        return c.json({ success: false, message: `操作失败: ${error.message}` }, 500);
    }
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

nodes.post('/batch-import', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    // The body can now contain either `links` (string) or `nodes` (array of objects)
    const body = await c.req.json<{ links?: string; nodes?: ParsedNode[]; groupId?: string }>();

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

export default nodes;