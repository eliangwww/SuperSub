import { Hono } from 'hono';
import { hash, compare } from 'bcrypt-ts';
import { sign } from 'hono/jwt';
import type { Env } from '../utils/types';

const auth = new Hono<{ Bindings: Env }>();

auth.post('/register', async (c) => {
    // Check if registration is allowed
    const allowRegistrationSetting = await c.env.DB.prepare(
        `SELECT value FROM system_settings WHERE key = 'allow_registration'`
    ).first<{ value: string }>();

    // Default to 'true' if the setting is not found, for backward compatibility.
    const isRegistrationAllowed = allowRegistrationSetting?.value !== 'false';

    if (!isRegistrationAllowed) {
        return c.json({ success: false, message: 'User registration is currently disabled by the administrator.' }, 403);
    }

    const { username, password } = await c.req.json();
    if (!username || !password) {
        return c.json({ success: false, message: 'Missing username or password' }, 400);
    }
    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existingUser) {
        return c.json({ success: false, message: 'Username already exists' }, 409);
    }
    const userCountResult = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'system'").first<{ count: number }>();
    const userCount = userCountResult?.count ?? 0;
    let role = userCount === 0 ? 'admin' : 'user';
    const hashedPassword = await hash(password, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare('INSERT INTO users (id, username, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, username, hashedPassword, role, now, now).run();
    return c.json({ success: true, data: { id, username, role } }, 201);
});

auth.post('/login', async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
        return c.json({ success: false, message: 'Missing username or password' }, 400);
    }
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
    if (!user) {
        return c.json({ success: false, message: 'User not found' }, 404);
    }
    const isPasswordValid = await compare(password, user.password as string);
    if (!isPasswordValid) {
        return c.json({ success: false, message: 'Invalid password' }, 401);
    }
    const payload = { id: user.id, username: user.username, role: user.role || 'user', exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) };
    const token = await sign(payload, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, user: payload } });
});

export default auth;