import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';

const assets = new Hono<{ Bindings: Env }>();

// All routes in this group require auth
assets.use('*', manualAuthMiddleware);

assets.get('/', async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare("SELECT *, CASE WHEN is_default = 1 THEN 1 ELSE 0 END as is_default FROM subconverter_assets WHERE user_id = ? OR user_id = 'system-user-001'").bind(user.id).all();
    return c.json({ success: true, data: results });
});

assets.post('/', async (c) => {
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

assets.put('/:id/default', async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.param();

    // First, get the type of the asset being set as default
    const asset = await c.env.DB.prepare("SELECT type FROM subconverter_assets WHERE id = ? AND (user_id = ? OR user_id = 'system-user-001')").bind(id, user.id).first<{ type: string }>();

    if (!asset) {
        return c.json({ success: false, message: 'Asset not found or permission denied.' }, 404);
    }

    // Start a transaction
    const stmts = [
        // Reset all defaults for this user and this asset type
        c.env.DB.prepare("UPDATE subconverter_assets SET is_default = 0 WHERE (user_id = ? OR user_id = 'system-user-001') AND type = ?").bind(user.id, asset.type),
        // Set the new default
        c.env.DB.prepare("UPDATE subconverter_assets SET is_default = 1 WHERE id = ? AND (user_id = ? OR user_id = 'system-user-001')").bind(id, user.id)
    ];
    
    await c.env.DB.batch(stmts);

    return c.json({ success: true, message: 'Default asset updated successfully.' });
});

assets.put('/:id', async (c) => {
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

assets.delete('/:id', async (c) => {
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

export default assets;