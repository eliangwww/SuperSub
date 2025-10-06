import { Hono } from 'hono';
import type { Env } from '../utils/types';
import { manualAuthMiddleware } from '../middleware/auth';

const user = new Hono<{ Bindings: Env }>();

user.use('*', manualAuthMiddleware);

// GET /api/user/defaults - Get user's default assets
user.get('/defaults', async (c) => {
  const payload = c.get('jwtPayload');
  try {
    const defaults = await c.env.DB.prepare(
      'SELECT default_backend_id, default_config_id FROM user_default_assets WHERE user_id = ?'
    ).bind(payload.id).first();

    return c.json({ success: true, data: defaults || {} });
  } catch (error: any) {
    console.error('Failed to get user defaults:', error);
    return c.json({ success: false, message: `Database error: ${error.message}` }, 500);
  }
});

// PUT /api/user/defaults - Set user's default assets
user.put('/defaults', async (c) => {
  const payload = c.get('jwtPayload');
  const { default_backend_id, default_config_id } = await c.req.json();

  try {
    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_default_assets WHERE user_id = ?'
    ).bind(payload.id).first();

    if (existing) {
      // Update existing record
      const newBackendId = default_backend_id !== undefined ? default_backend_id : (existing as any).default_backend_id;
      const newConfigId = default_config_id !== undefined ? default_config_id : (existing as any).default_config_id;
      
      await c.env.DB.prepare(
        'UPDATE user_default_assets SET default_backend_id = ?, default_config_id = ? WHERE user_id = ?'
      ).bind(newBackendId, newConfigId, payload.id).run();

    } else {
      // Insert new record
      await c.env.DB.prepare(
        'INSERT INTO user_default_assets (user_id, default_backend_id, default_config_id) VALUES (?, ?, ?)'
      ).bind(
        payload.id,
        default_backend_id !== undefined ? default_backend_id : null,
        default_config_id !== undefined ? default_config_id : null
      ).run();
    }

    return c.json({ success: true, message: 'Default assets updated successfully.' });
  } catch (error: any) {
    console.error('Failed to update user defaults:', error);
    return c.json({ success: false, message: `Database error: ${error.message}` }, 500);
  }
});

export default user;