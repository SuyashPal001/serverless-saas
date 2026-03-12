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
import { permissionsMiddleware } from './middleware/permissions';
import { queryScopeMiddleware } from './middleware/queryScope';
import { authRoutes, authPublicRoutes } from './routes/auth';
import { membersRoutes } from './routes/members';
import { rolesRoutes } from './routes/roles';
import { apiKeysRoutes } from './routes/api-keys';
import { agentsRoutes } from './routes/agents';
import { agentRunsRoutes } from './routes/agent-runs';
import { notificationsRoutes } from './routes/notifications';
import { auditLogRoutes } from './routes/audit-log';
import { billingRoutes } from './routes/billing';
import { opsRoutes } from './routes/ops';
import { authInjectionMiddleware } from './middleware/authInjection';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.onError(errorHandler);

// Health routes — bypass all auth/tenant middleware
app.route('/health', healthRoutes);

const publicApi = new Hono<AppEnv>();
const secureApi = new Hono<AppEnv>();

// ── Middleware chain ──────────────────────────────────────────────────────────

// Step 1: JWT extraction
publicApi.use('*', authInjectionMiddleware);
secureApi.use('*', authInjectionMiddleware);

// Step 2: User upsert
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

// Step 7: Permissions
secureApi.use('*', permissionsMiddleware);

// Step 8: Query scope
secureApi.use('*', queryScopeMiddleware);

// ── Routes — register BEFORE mounting ────────────────────────────────────────

// Public routes
publicApi.route('/auth', authPublicRoutes);
publicApi.route('/onboarding', onboardingRoutes);


// Secure routes
secureApi.route('/auth', authRoutes);
secureApi.route('/members', membersRoutes);
secureApi.route('/roles', rolesRoutes);
secureApi.route('/api-keys', apiKeysRoutes);
secureApi.route('/agents', agentsRoutes);
secureApi.route('/agent-runs', agentRunsRoutes);
secureApi.route('/notifications', notificationsRoutes);
secureApi.route('/audit-log', auditLogRoutes);
secureApi.route('/billing', billingRoutes);
secureApi.route('/ops', opsRoutes);
// ── Mount — AFTER all routes are registered ───────────────────────────────────
app.route('/api/v1', publicApi);
app.route('/api/v1', secureApi);

export { app, publicApi, secureApi };