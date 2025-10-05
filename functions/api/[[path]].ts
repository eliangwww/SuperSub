import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { Env } from './utils/types';
import { methodOverrideMiddleware } from './middleware/methodOverride';
import { manualAuthMiddleware } from './middleware/auth';

// Import routes
import authRoutes from './routes/auth';
import nodeRoutes from './routes/nodes';
import subscriptionRoutes from './routes/subscriptions';
import profileRoutes from './routes/profiles';
import adminRoutes from './routes/admin';
import assetRoutes from './routes/assets';
import groupRoutes from './routes/groups';

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Middleware
app.use('*', methodOverrideMiddleware(app));

// Public routes
app.route('/auth', authRoutes);

// Authenticated routes
app.route('/nodes', nodeRoutes);
app.route('/subscriptions', subscriptionRoutes);
app.route('/profiles', profileRoutes);
app.route('/admin', adminRoutes);
app.route('/subconverter-assets', assetRoutes);
app.route('/groups', groupRoutes);

// Other remaining routes from the original file
app.get('/stats', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const [subscriptions, nodes, profiles] = await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE user_id = ?').bind(user.id).first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM nodes WHERE user_id = ?').bind(user.id).first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM profiles WHERE user_id = ?').bind(user.id).first<{ count: number }>()
    ]);
    return c.json({ success: true, data: { subscriptions: subscriptions?.count ?? 0, nodes: nodes?.count ?? 0, profiles: profiles?.count ?? 0 } });
});

app.get('/node-statuses', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT id as node_id, status, latency, last_checked, error FROM nodes WHERE user_id = ?').bind(user.id).all();
    const validStatuses = ['pending', 'testing', 'healthy', 'unhealthy'];
    const sanitizedResults = (results as any[]).map(r => ({ ...r, status: validStatuses.includes(r.status) ? r.status : 'pending' }));
    return c.json({ success: true, data: sanitizedResults });
});

app.get('/settings', manualAuthMiddleware, async (c) => {
    const user = c.get('jwtPayload');
    const { results } = await c.env.DB.prepare('SELECT * FROM settings WHERE user_id = ?').bind(user.id).all();
    return c.json({ success: true, data: results });
});


export const onRequest = handle(app);
