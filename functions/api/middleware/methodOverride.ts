import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import type { Env } from '../utils/types';

// Middleware to handle X-HTTP-Method-Override for Cloudflare Pages compatibility
export const methodOverrideMiddleware = (app: Hono<{ Bindings: Env }>) => {
  return async (c: Context, next: Next) => {
    const overrideMethod = c.req.header('X-HTTP-Method-Override');
    if (c.req.method === 'POST' && overrideMethod) {
      const newMethod = overrideMethod.toUpperCase();
      if (['PUT', 'DELETE'].includes(newMethod)) {
        // Reconstruct the request with the overridden method.
        const newReq = new Request(c.req.raw, {
          method: newMethod,
        });
        // Manually dispatch the new request to the Hono app.
        return app.fetch(newReq, c.env, c.executionCtx);
      }
    }
    // If no override, continue with the normal flow.
    await next();
  };
};