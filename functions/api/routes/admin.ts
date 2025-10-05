import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';

const admin = new Hono<{ Bindings: Env }>();

// All routes in this group require auth
admin.use('*', manualAuthMiddleware);

admin.get('/users', async (c) => {
    const { results } = await c.env.DB.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE role != 'system'").all();
    return c.json({ success: true, data: results });
});

admin.get('/system-settings', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM system_settings').all();
    const settings = (results as any[]).reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
    }, {});
    return c.json({ success: true, data: settings });
});

export default admin;