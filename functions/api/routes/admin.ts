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

admin.post('/system-settings', async (c) => {
    const body = await c.req.json();
    const key = 'allow_registration';
    const value = String(body[key]);

    if (value !== 'true' && value !== 'false') {
        return c.json({ success: false, message: 'Invalid value for allow_registration' }, 400);
    }

    try {
        // Use INSERT OR REPLACE to create the setting if it doesn't exist, or update it if it does.
        await c.env.DB.prepare(
            `INSERT INTO system_settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).bind(key, value).run();

        return c.json({ success: true, message: 'Settings updated successfully' });
    } catch (error: any) {
        console.error('Failed to update system settings:', error);
        return c.json({ success: false, message: `Database error: ${error.message}` }, 500);
    }
});

export default admin;