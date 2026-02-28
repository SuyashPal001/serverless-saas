import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.onError(errorHandler);

// Health routes — bypass all auth/tenant middleware
app.route('/health', healthRoutes);

// ============================================
// Middleware chain (applied to /api/* routes)
// ============================================
// Order matters — matches the foundation middleware chain:
//   1. Auth Context (extract claims, resolve user)
//   2. Session Validation (jti against Upstash blacklist)
//   3. Tenant Resolution (full tenant context, check status)
//   4. Rate Limiting (entitlements cache → Redis INCR → 429)
//   5. Feature Gating (entitlements cache → 403)
//   6. Permission Check (RBAC cache → 403)
//   7. Query Scoping (attach tenantId to all Drizzle queries)
//
// Each middleware will be wired in as packages are completed.
// For now, the chain is documented but not enforced.
// ============================================

const api = new Hono<AppEnv>();

// TODO: Wire middleware as packages complete
// api.use('*', authMiddleware);
// api.use('*', sessionMiddleware);
// api.use('*', tenantMiddleware);
// api.use('*', rateLimitMiddleware);
// api.use('*', featureGateMiddleware);
// api.use('*', permissionMiddleware);
// api.use('*', queryScopeMiddleware);

// Mount API routes under /api/v1
app.route('/api/v1', api);

export { app };
export { api };
