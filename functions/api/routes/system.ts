import { Hono } from 'hono';
import type { Env } from '../utils/types';

const system = new Hono<{ Bindings: Env }>();

system.get('/settings', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM system_settings').all();
    const settings = (results as any[]).reduce((acc, setting) => {
        // Only expose public settings
        if (setting.key === 'allow_registration') {
            acc[setting.key] = setting.value;
        }
        return acc;
    }, {});
    
    // If allow_registration is not in the database, default to 'true'
    if (settings.allow_registration === undefined) {
        settings.allow_registration = 'true';
    }

    return c.json({ success: true, data: settings });
});

export default system;