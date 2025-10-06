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

// GET /api/user/me - Get user's profile
user.get('/me', (c) => {
    const user = c.get('jwtPayload');
    return c.json({ success: true, data: user });
});

// GET /api/user/sub-token - Get or create user's subscription token
user.get('/sub-token', async (c) => {
    const userPayload = c.get('jwtPayload');

    // 1. Check JWT first
    if (userPayload.sub_token) {
        return c.json({ success: true, data: { token: userPayload.sub_token } });
    }

    // 2. If not in JWT, check DB
    const userFromDb = await c.env.DB.prepare('SELECT sub_token FROM users WHERE id = ?').bind(userPayload.id).first<{ sub_token: string }>();
    if (userFromDb && userFromDb.sub_token) {
        return c.json({ success: true, data: { token: userFromDb.sub_token } });
    }

    // 3. If not in DB, create, save, and return
    const newToken = crypto.randomUUID();
    try {
        await c.env.DB.prepare('UPDATE users SET sub_token = ? WHERE id = ?').bind(newToken, userPayload.id).run();
        return c.json({ success: true, data: { token: newToken } });
    } catch (error) {
        console.error("Failed to create and save new sub_token:", error);
        return c.json({ success: false, message: 'Failed to generate subscription token.' }, 500);
    }
});

// POST /api/user/sub-token/reset - Reset user's subscription token
user.post('/sub-token/reset', async (c) => {
    const userPayload = c.get('jwtPayload');
    const newToken = crypto.randomUUID();
    
    await c.env.DB.prepare('UPDATE users SET sub_token = ? WHERE id = ?').bind(newToken, userPayload.id).run();
    
    return c.json({ success: true, data: { token: newToken } });
});

export default user;