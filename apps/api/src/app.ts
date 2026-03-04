import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import type { AppEnv } from './types';
import { userUpsertMiddleware } from './middleware/userUpsert';


const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.onError(errorHandler);

// Health routes — bypass all auth/tenant middleware
app.route('/health', healthRoutes);

// Public routes — JWT extraction + user upsert only (no tenant/permission checks)
const publicApi = new Hono<AppEnv>();

// Protected routes — full middleware chain
const secureApi = new Hono<AppEnv>();

// Step 1: JWT extraction (TODO — not built yet)
// Step 2: User upsert — create or sync user from Cognito claims
publicApi.use('*', userUpsertMiddleware);
secureApi.use('*', userUpsertMiddleware);

// TODO: Wire middleware as packages complete
// secureApi.use('*', authMiddleware);
// secureApi.use('*', sessionMiddleware);
// secureApi.use('*', tenantMiddleware);
// secureApi.use('*', rateLimitMiddleware);
// secureApi.use('*', featureGateMiddleware);
// secureApi.use('*', permissionMiddleware);
// secureApi.use('*', queryScopeMiddleware);

// Mount API routes under /api/v1
app.route('/api/v1/', publicApi);
app.route('/api/v1/', secureApi);

export { app, publicApi, secureApi };
