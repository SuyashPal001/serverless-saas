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
import { entitlementsRoutes } from './routes/entitlements';
import { randomUUID } from 'crypto';

const app = new Hono<AppEnv>();

// Global middlewaregit p
app.use('*', cors());

// First middleware — generates traceId for every request
app.use('*', async (c, next) => {
    c.set('traceId', randomUUID());
    c.set('startTime', Date.now());
    await next();
});

app.onError(errorHandler);

// Health routes — bypass all auth/tenant middleware
app.route('/health', healthRoutes);

const api = new Hono<AppEnv>();

// ── Middleware chain ──────────────────────────────────────────────────────────

// Step 1: JWT extraction
api.use('*', authInjectionMiddleware);

// Step 2: User upsert
api.use('*', userUpsertMiddleware);

// Step 3: API key auth
api.use('*', apiKeyAuthMiddleware);

// ── Public routes — registered BEFORE secure middleware ───────────────────────
api.route('/auth', authPublicRoutes);
api.route('/onboarding', onboardingRoutes);

// ── Secure middleware — runs for all routes below ─────────────────────────────

// Step 4: Tenant resolution
api.use('*', tenantResolutionMiddleware);

// Step 5: Session validation
api.use('*', sessionValidationMiddleware);

// Step 6: Entitlements
api.use('*', entitlementsMiddleware);

// Step 7: Permissions
api.use('*', permissionsMiddleware);

// Step 8: Query scope
api.use('*', queryScopeMiddleware);

// ── Secure routes ─────────────────────────────────────────────────────────────
api.route('/auth', authRoutes);
api.route('/members', membersRoutes);
api.route('/roles', rolesRoutes);
api.route('/api-keys', apiKeysRoutes);
api.route('/agents', agentsRoutes);
api.route('/agent-runs', agentRunsRoutes);
api.route('/notifications', notificationsRoutes);
api.route('/audit-log', auditLogRoutes);
api.route('/billing', billingRoutes);
api.route('/ops', opsRoutes);
api.route('/entitlements', entitlementsRoutes);

// ── Mount ─────────────────────────────────────────────────────────────────────
app.route('/api/v1', api);

export { app };