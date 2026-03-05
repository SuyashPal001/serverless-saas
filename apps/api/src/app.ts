import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import type { AppEnv } from './types';
import { userUpsertMiddleware } from './middleware/userUpsert';
import { onboardingRoutes } from './routes/onboarding';
import { apiKeyAuthMiddleware } from './middleware/apiKeyAuth';
import { tenantResolutionMiddleware } from './middleware/tenantResolution';
import { sessionValidationMiddleware } from './middleware/sessionValidation';
import { entitlementsMiddleware } from './middleware/entitlements';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.onError(errorHandler);

// Health routes — bypass all auth/tenant middleware
app.route('/health', healthRoutes);

// Step 1: JWT extraction 
// Public routes — JWT extraction + user upsert only (no tenant/permission checks)
const publicApi = new Hono<AppEnv>();
// Protected routes — full middleware chain
const secureApi = new Hono<AppEnv>();

// Step 2: User upsert — create or sync user from Cognito claims
publicApi.use('*', userUpsertMiddleware);
secureApi.use('*', userUpsertMiddleware);

// Step 3: API key auth
publicApi.use('*', apiKeyAuthMiddleware);
secureApi.use('*', apiKeyAuthMiddleware);

// Step 4: Tenant resolution
secureApi.use('*', tenantResolutionMiddleware);

// Step 5: Session validation
secureApi.use('*', sessionValidationMiddleware);

// Step 6: Entitlements
secureApi.use('*', entitlementsMiddleware);

// TODO: Wire middleware as packages complete
// secureApi.use('*', authMiddleware);
// secureApi.use('*', sessionMiddleware);
// secureApi.use('*', tenantMiddleware);
// secureApi.use('*', rateLimitMiddleware);
// secureApi.use('*', featureGateMiddleware);
// secureApi.use('*', permissionMiddleware);
// secureApi.use('*', queryScopeMiddleware);

// Mount API routes under /api/v1
publicApi.route('/onboarding', onboardingRoutes);
app.route('/api/v1/', publicApi);
app.route('/api/v1/', secureApi);

export { app, publicApi, secureApi };
