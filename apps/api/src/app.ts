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
import { except } from 'hono/combine';
import { invitationsPublicRoutes, memberInviteRoutes } from './routes/invitations';
import { membersRoutes } from './routes/members';
import { rolesRoutes } from './routes/roles';
import { apiKeysRoutes } from './routes/api-keys';
import { agentsRoutes } from './routes/agents';
import { agentSkillsRoutes } from './routes/agent-skills';
import { agentPoliciesRoutes } from './routes/agent-policies';
import { agentRunsRoutes } from './routes/agent-runs';
import { conversationsRoutes } from './routes/conversations';
import { messagesRoutes } from './routes/messages';
import { notificationsRoutes } from './routes/notifications';
import { auditLogRoutes } from './routes/audit-log';
import { billingRoutes } from './routes/billing';
import { brandingRoutes } from './routes/branding';
import { opsRoutes } from './routes/ops';
import { authInjectionMiddleware } from './middleware/authInjection';
import { entitlementsRoutes } from './routes/entitlements';
import { tenantsRoutes } from './routes/tenants';
import { usageRoutes } from './routes/usage';
import { webhooksRoutes } from './routes/webhooks';
import { filesRoutes } from './routes/files';
import { eventsRoutes } from './routes/events';
import { integrationsRoutes, googleOAuthCallbackRoute, zohoOAuthCallbackRoute, jiraOAuthCallbackRoute } from './routes/integrations';
import { llmProvidersRoutes } from './routes/llm-providers';
import { usageRecordingMiddleware } from './middleware/usageRecording';
import { widgetRoutes } from './routes/widget';
import { sessionsRoutes } from './routes/sessions';
import { usersRoutes } from './routes/users';
import { workspacesRoutes } from './routes/workspaces';
import documentsRoutes from './routes/documents';
import internalRetrieveRoute from './routes/internal/retrieve';
import { evalsFeedbackRoutes, evalsRoutes } from './routes/evals';
import internalEvalsRoute from './routes/internal/evals';
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

const publicApi = new Hono<AppEnv>();
publicApi.route('/auth', authPublicRoutes);
publicApi.route('/widget', widgetRoutes);
publicApi.route('/integrations', googleOAuthCallbackRoute); // Google OAuth callback — no auth
publicApi.route('/integrations', zohoOAuthCallbackRoute);   // Zoho OAuth callback — no auth
publicApi.route('/integrations', jiraOAuthCallbackRoute);   // Jira OAuth callback — no auth

const api = new Hono<AppEnv>();

// ── Middleware chain ──────────────────────────────────────────────────────────

// Step 1: JWT extraction
api.use('*', authInjectionMiddleware);

// Step 2: User upsert
api.use('*', userUpsertMiddleware);

// Onboarding — needs auth + upsert, tenantResolution handles empty tenantId
api.route('/onboarding', onboardingRoutes);
api.route('/invitations', invitationsPublicRoutes);
api.route('/tenants', tenantsRoutes);

// Step 3: API key auth
api.use('*', apiKeyAuthMiddleware);

// ── Secure middleware — runs for all routes below ─────────────────────────────

// Step 4: Tenant resolution
api.use('*', tenantResolutionMiddleware);

// Step 5: Session validation — skipped for /auth/me and /auth/tenants (called pre-session at login)
api.use('*', except(['/auth/me', '/auth/tenants'], sessionValidationMiddleware));

// Step 6: Entitlements
api.use('*', entitlementsMiddleware);

// Step 7: Permissions
api.use('*', permissionsMiddleware);

// Step 8: Query scope
api.use('*', queryScopeMiddleware);

// Step 9: Usage Recording
api.use('*', usageRecordingMiddleware);

// ── Secure routes ─────────────────────────────────────────────────────────────
api.route('/auth', authRoutes);
api.route('/members', membersRoutes);
api.route('/members', memberInviteRoutes);
api.route('/roles', rolesRoutes);
api.route('/api-keys', apiKeysRoutes);
api.route('/agents', agentsRoutes);
api.route('/agents', agentSkillsRoutes);
api.route('/agents', agentPoliciesRoutes);
api.route('/agent-runs', agentRunsRoutes);
api.route('/notifications', notificationsRoutes);
api.route('/audit-log', auditLogRoutes);
api.route('/billing', billingRoutes);
api.route('/branding', brandingRoutes);
api.route('/ops', opsRoutes);
api.route('/entitlements', entitlementsRoutes);
api.route('/usage', usageRoutes);
api.route('/webhooks', webhooksRoutes);
api.route('/events', eventsRoutes);
api.route('/files', filesRoutes);
api.route('/integrations', integrationsRoutes);
api.route('/conversations', evalsFeedbackRoutes);
api.route('/conversations', conversationsRoutes);
api.route('/conversations', messagesRoutes);
api.route('/evals', evalsRoutes);
api.route('/sessions', sessionsRoutes);
api.route('/users', usersRoutes);
api.route('/workspaces', workspacesRoutes);
api.route('/llm-providers', llmProvidersRoutes);
api.route('/documents', documentsRoutes);

const internalApi = new Hono<AppEnv>();
internalApi.route('/internal', internalRetrieveRoute);
internalApi.route('/internal/evals', internalEvalsRoute);

// ── Mount ─────────────────────────────────────────────────────────────────────
app.route('/api/v1', publicApi);
app.route('/api/v1', internalApi);
app.route('/api/v1', api);

console.log('REGISTERED ROUTES:', api.routes.map(r => `${r.method} ${r.path}`));

export { app };