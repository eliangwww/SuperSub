import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware, adminAuthMiddleware } from '../middleware/auth';

const admin = new Hono<{ Bindings: Env }>();

// All routes in this group require auth and admin role
admin.use('*', manualAuthMiddleware, adminAuthMiddleware);

admin.get('/users', async (c) => {
    const { results } = await c.env.DB.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE role != 'system'").all();
    return c.json({ success: true, data: results });
});

admin.put('/users/:id', async (c) => {
    const userId = c.req.param('id');
    const { role } = await c.req.json();

    if (!['admin', 'user'].includes(role)) {
        return c.json({ success: false, message: 'Invalid role' }, 400);
    }

    try {
        const { success } = await c.env.DB.prepare(
            'UPDATE users SET role = ? WHERE id = ?'
        ).bind(role, userId).run();

        if (success) {
            return c.json({ success: true, message: 'User role updated successfully' });
        } else {
            return c.json({ success: false, message: 'User not found or no changes made' }, 404);
        }
    } catch (error: any) {
        console.error('Failed to update user role:', error);
        return c.json({ success: false, message: `Database error: ${error.message}` }, 500);
    }
});

admin.delete('/users/:id', async (c) => {
    const userId = c.req.param('id');

    try {
        const { success } = await c.env.DB.prepare(
            'DELETE FROM users WHERE id = ?'
        ).bind(userId).run();

        if (success) {
            return c.json({ success: true, message: 'User deleted successfully' });
        } else {
            return c.json({ success: false, message: 'User not found' }, 404);
        }
    } catch (error: any) {
        console.error('Failed to delete user:', error);
        return c.json({ success: false, message: `Database error: ${error.message}` }, 500);
    }
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