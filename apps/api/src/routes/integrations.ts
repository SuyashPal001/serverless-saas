import { Hono, type Context } from 'hono';
import { and, eq, desc, count, sql } from 'drizzle-orm';
import { createCipheriv, scryptSync, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { integrations } from '@serverless-saas/database/schema/integrations';
import { tenants } from '@serverless-saas/database/schema/tenancy';
import { agents } from '@serverless-saas/database/schema/agents';
import { agentSkills } from '@serverless-saas/database/schema/conversations';
import { features } from '@serverless-saas/database/schema/entitlements';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

// ── Encryption ────────────────────────────────────────────────────────────────
// AES-256-GCM with per-tenant key derived from the master key.
// NEVER log the return value or any value passed in.

function encryptCredentials(data: object, tenantId: string): string {
    const masterKey = process.env.TOKEN_ENCRYPTION_KEY!;
    const key = scryptSync(masterKey, tenantId, 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.from(JSON.stringify({
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        data: encrypted.toString('base64'),
    })).toString('base64');
}

// ── UUID check helper ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Provider → tool names map ─────────────────────────────────────────────────
// Used to merge/remove tools in agent_skills.tools on connect/disconnect.

const PROVIDER_TOOLS_MAP: Record<string, string[]> = {
    gmail:     ['GMAIL_SEND_EMAIL', 'GMAIL_SEARCH_EMAILS', 'GMAIL_READ_EMAIL'],
    drive:     ['GDRIVE_SEARCH_FILES', 'GDRIVE_READ_FILE'],
    calendar:  ['GCAL_LIST_EVENTS', 'GCAL_CREATE_EVENT'],
    zoho_crm:  ['ZOHO_SEARCH_CONTACTS', 'ZOHO_GET_CONTACT', 'ZOHO_CREATE_CONTACT', 'ZOHO_SEARCH_DEALS', 'ZOHO_CREATE_DEAL'],
    zoho_mail: ['ZOHO_MAIL_LIST_MESSAGES', 'ZOHO_MAIL_GET_MESSAGE', 'ZOHO_MAIL_SEND_MESSAGE'],
    zoho_cliq: ['ZOHO_CLIQ_LIST_CHANNELS', 'ZOHO_CLIQ_GET_CHANNEL_MESSAGES', 'ZOHO_CLIQ_SEND_MESSAGE'],
    jira:      ['JIRA_SEARCH_ISSUES', 'JIRA_GET_ISSUE', 'JIRA_CREATE_ISSUE', 'JIRA_UPDATE_ISSUE', 'JIRA_LIST_PROJECTS'],
};

// Merges provider tools into agent_skills.tools and fires relay /update.
// Non-throwing — logs errors but does not block the calling handler.
async function syncToolsAndNotifyRelay(tenantId: string, provider: string, action: 'add' | 'remove'): Promise<void> {
    const providerTools = PROVIDER_TOOLS_MAP[provider];
    if (!providerTools?.length) return;

    try {
        // Find the tenant's active agent + its active skill
        const [agent] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.tenantId, tenantId), eq(agents.status, 'active')))
            .limit(1);
        if (!agent) return;

        const [skill] = await db
            .select({ id: agentSkills.id, tools: agentSkills.tools })
            .from(agentSkills)
            .where(and(eq(agentSkills.agentId, agent.id), eq(agentSkills.tenantId, tenantId), eq(agentSkills.status, 'active')))
            .limit(1);
        if (!skill) return;

        const current = skill.tools ?? [];
        const updated = action === 'add'
            ? [...new Set([...current, ...providerTools])]
            : current.filter((t: string) => !providerTools.includes(t));

        await db.update(agentSkills)
            .set({ tools: updated, updatedAt: new Date() })
            .where(eq(agentSkills.id, skill.id));

        const relayUrl = process.env.RELAY_URL;
        if (relayUrl) {
            fetch(`${relayUrl}/update/${tenantId}/${agent.id}`, {
                method: 'POST',
                headers: { 'x-service-key': process.env.INTERNAL_SERVICE_KEY!, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }).catch((e: Error) => console.warn('[relay update failed]', e.message));
        }
    } catch (err) {
        console.error(`[syncToolsAndNotifyRelay] provider=${provider} action=${action}:`, (err as Error).message);
    }
}

// ── Auth-protected routes ─────────────────────────────────────────────────────
// Mounted at /api/v1/integrations — runs through the full middleware chain.

export const integrationsRoutes = new Hono<AppEnv>();

// GET /integrations/providers — static list of supported providers
// Must be defined before /:id to prevent route shadowing.
integrationsRoutes.get('/providers', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'integrations', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const providers = [
        { id: 'gmail',    name: 'Gmail',           type: 'oauth', description: 'Read, search and send emails' },
        { id: 'drive',    name: 'Google Drive',    type: 'oauth', description: 'Search and read files from Drive' },
        { id: 'calendar', name: 'Google Calendar', type: 'oauth', description: 'View and create calendar events' },
        { id: 'zoho_crm',  name: 'Zoho CRM',  type: 'oauth', description: 'Manage contacts, leads and deals' },
        { id: 'zoho_mail', name: 'Zoho Mail', type: 'oauth', description: 'Read and send emails via Zoho Mail' },
        { id: 'zoho_cliq', name: 'Zoho Cliq', type: 'oauth', description: 'Send messages and read channels' },
        { id: 'jira',      name: 'Jira',      type: 'oauth', description: 'Read and write Jira issues and projects' },
        { id: 'github',   name: 'GitHub',          type: 'mcp' },
        { id: 'linear',   name: 'Linear',          type: 'mcp' },
        { id: 'slack',    name: 'Slack',           type: 'mcp' },
        { id: 'notion',   name: 'Notion',          type: 'mcp' },
        { id: 'hubspot',  name: 'HubSpot',         type: 'mcp' },
        { id: 'zapier',   name: 'Zapier',          type: 'mcp' },
    ];

    return c.json({ data: providers });
});

// ── Google per-service OAuth connect helper ───────────────────────────────────
// Each service requests only its own scope — privacy-first approach.

async function googleConnectHandler(
    c: Context<AppEnv>,
    service: 'gmail' | 'drive' | 'calendar',
    scope: string,
) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Google OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    const tenantRow = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    const slug = tenantRow[0]?.slug ?? '';

    // Embed service in state so the callback knows which provider row to write.
    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, slug, service, ts: Date.now() })
    ).toString('base64');

    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope,
        access_type:   'offline',
        prompt:        'consent',
        state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return c.json({ url });
}

// POST /integrations/google/gmail/connect
integrationsRoutes.post('/google/gmail/connect', (c) =>
    googleConnectHandler(c, 'gmail', 'https://www.googleapis.com/auth/gmail.modify'));

// POST /integrations/google/drive/connect
integrationsRoutes.post('/google/drive/connect', (c) =>
    googleConnectHandler(c, 'drive', 'https://www.googleapis.com/auth/drive'));

// POST /integrations/google/calendar/connect
integrationsRoutes.post('/google/calendar/connect', (c) =>
    googleConnectHandler(c, 'calendar', 'https://www.googleapis.com/auth/calendar'));

// POST /integrations/zoho/crm/connect — generate Zoho CRM OAuth URL
// India data center (.in) — scope is comma-separated per Zoho convention.
integrationsRoutes.post('/zoho/crm/connect', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId    = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Zoho OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    const tenantRow = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    const slug = tenantRow[0]?.slug ?? '';

    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, slug, service: 'zoho_crm', ts: Date.now() })
    ).toString('base64');

    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'ZohoCRM.modules.ALL,ZohoCRM.settings.ALL',
        access_type:   'offline',
        prompt:        'consent',
        state,
    });

    const url = `https://accounts.zoho.in/oauth/v2/auth?${params.toString()}`;
    return c.json({ url });
});

// POST /integrations/zoho/mail/connect — generate Zoho Mail OAuth URL
integrationsRoutes.post('/zoho/mail/connect', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId    = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Zoho OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    const tenantRow = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    const slug = tenantRow[0]?.slug ?? '';

    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, slug, service: 'zoho_mail', ts: Date.now() })
    ).toString('base64');

    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE',
        access_type:   'offline',
        prompt:        'consent',
        state,
    });

    const url = `https://accounts.zoho.in/oauth/v2/auth?${params.toString()}`;
    return c.json({ url });
});

// POST /integrations/zoho/cliq/connect — generate Zoho Cliq OAuth URL
integrationsRoutes.post('/zoho/cliq/connect', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId    = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Zoho OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    const tenantRow = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    const slug = tenantRow[0]?.slug ?? '';

    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, slug, service: 'zoho_cliq', ts: Date.now() })
    ).toString('base64');

    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'ZohoCliq.messages.ALL,ZohoCliq.channels.READ',
        access_type:   'offline',
        prompt:        'consent',
        state,
    });

    const url = `https://accounts.zoho.in/oauth/v2/auth?${params.toString()}`;
    return c.json({ url });
});

// POST /integrations/jira/connect — generate Atlassian OAuth 2.0 (3LO) URL
// offline_access scope is required to receive a refresh token.
integrationsRoutes.post('/jira/connect', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId    = process.env.JIRA_CLIENT_ID;
    const redirectUri = process.env.JIRA_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Jira OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    const tenantRow = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    const slug = tenantRow[0]?.slug ?? '';

    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, slug, service: 'jira', ts: Date.now() })
    ).toString('base64');

    // Atlassian scopes are space-separated; offline_access grants the refresh token.
    const params = new URLSearchParams({
        audience:      'api.atlassian.com',
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'read:jira-work write:jira-work offline_access',
        prompt:        'consent',
        state,
    });

    const url = `https://auth.atlassian.com/authorize?${params.toString()}`;
    return c.json({ url });
});

// GET /integrations — list tenant's connected integrations
// Returns only status = 'connected'; never selects credentials_enc.
integrationsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'integrations', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const rows = await db
        .select({
            id:          integrations.id,
            provider:    integrations.provider,
            status:      integrations.status,
            permissions: integrations.permissions,
            createdAt:   integrations.createdAt,
        })
        .from(integrations)
        .where(and(
            eq(integrations.tenantId, tenantId),
            eq(integrations.status, 'active'),
        ))
        .orderBy(desc(integrations.createdAt));

    return c.json({ integrations: rows });
});

// GET /integrations/:id — get a single integration by UUID
integrationsRoutes.get('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'integrations', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');

    const [data] = await db
        .select({
            id:           integrations.id,
            provider:     integrations.provider,
            mcpServerUrl: integrations.mcpServerUrl,
            status:       integrations.status,
            permissions:  integrations.permissions,
            createdAt:    integrations.createdAt,
            updatedAt:    integrations.updatedAt,
        })
        .from(integrations)
        .where(and(
            eq(integrations.id, id),
            eq(integrations.tenantId, tenantId),
        ))
        .limit(1);

    if (!data) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data });
});

// POST /integrations — create/connect a generic MCP integration
integrationsRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    // Check integrations limit
    const entitlements = requestContext?.entitlements as Record<string, { valueLimit?: number; unlimited?: boolean }> | undefined;
    if (entitlements) {
        const [integrationsFeature] = await db
            .select({ id: features.id })
            .from(features)
            .where(eq(features.key, 'integrations'))
            .limit(1);

        if (integrationsFeature) {
            const entitlement = entitlements[integrationsFeature.id];
            if (entitlement && !entitlement.unlimited) {
                const [{ value: used }] = await db
                    .select({ value: count() })
                    .from(integrations)
                    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.status, 'active')));
                const limit = entitlement.valueLimit ?? 0;
                if (Number(used) >= limit) {
                    return c.json({
                        error: `Your plan allows a maximum of ${limit} integrations. Please upgrade to add more.`,
                        code: 'LIMIT_REACHED',
                    }, 403);
                }
            }
        }
    }

    const schema = z.object({
        provider:       z.string().min(1).max(50),
        mcpServerUrl:   z.string().url(),
        credentialsEnc: z.string().min(1),
        permissions:    z.array(z.string()).optional().default([]),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: result.error.flatten() }, 400);
    }

    try {
        const [created] = await db.insert(integrations).values({
            tenantId,
            provider:       result.data.provider,
            mcpServerUrl:   result.data.mcpServerUrl,
            credentialsEnc: result.data.credentialsEnc,
            permissions:    result.data.permissions,
            status:         'active',
            createdBy:      userId,
        }).returning({
            id:           integrations.id,
            provider:     integrations.provider,
            mcpServerUrl: integrations.mcpServerUrl,
            status:       integrations.status,
            permissions:  integrations.permissions,
            createdAt:    integrations.createdAt,
        });

        await db.insert(auditLog).values({
            tenantId,
            actorId:    userId ?? 'system',
            actorType:  'human',
            action:     'integration_connected',
            resource:   'integration',
            resourceId: created.id,
            metadata:   { provider: created.provider },
            traceId:    c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: created }, 201);
    } catch (err: any) {
        console.error('Failed to create integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});

// PATCH /integrations/:id — update permissions, status, or mcpServerUrl
integrationsRoutes.patch('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');

    const schema = z.object({
        status:         z.enum(['active', 'disconnected', 'error']).optional(),
        permissions:    z.array(z.string()).optional(),
        mcpServerUrl:   z.string().url().optional(),
        credentialsEnc: z.string().min(1).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: result.error.flatten() }, 400);
    }

    if (Object.keys(result.data).length === 0) {
        return c.json({ error: 'No fields provided', code: 'VALIDATION_ERROR' }, 400);
    }

    const [existing] = await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.id, id), eq(integrations.tenantId, tenantId)))
        .limit(1);

    if (!existing) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    try {
        const [updated] = await db.update(integrations)
            .set({ ...result.data, updatedAt: new Date() })
            .where(eq(integrations.id, id))
            .returning({
                id:           integrations.id,
                provider:     integrations.provider,
                mcpServerUrl: integrations.mcpServerUrl,
                status:       integrations.status,
                permissions:  integrations.permissions,
                updatedAt:    integrations.updatedAt,
            });

        await db.insert(auditLog).values({
            tenantId,
            actorId:    userId ?? 'system',
            actorType:  'human',
            action:     'integration_updated',
            resource:   'integration',
            resourceId: id,
            metadata:   { updates: Object.keys(result.data) },
            traceId:    c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: updated });
    } catch (err: any) {
        console.error('Failed to update integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});

// DELETE /integrations/:idOrProvider
//   UUID  → hard delete by integration id (existing behaviour)
//   Other → soft disconnect by provider name (sets status = 'disconnected')
integrationsRoutes.delete('/:idOrProvider', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const idOrProvider = c.req.param('idOrProvider');
    const isByUuid = UUID_RE.test(idOrProvider);

    const whereClause = isByUuid
        ? and(eq(integrations.id, idOrProvider),       eq(integrations.tenantId, tenantId))
        : and(eq(integrations.provider, idOrProvider), eq(integrations.tenantId, tenantId));

    const [existing] = await db
        .select()
        .from(integrations)
        .where(whereClause)
        .limit(1);

    if (!existing) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    try {
        if (isByUuid) {
            await db.delete(integrations).where(eq(integrations.id, idOrProvider));
        } else {
            await db.update(integrations)
                .set({ status: 'disconnected', updatedAt: new Date() })
                .where(whereClause);
        }

        await db.insert(auditLog).values({
            tenantId,
            actorId:    userId ?? 'system',
            actorType:  'human',
            action:     'integration_disconnected',
            resource:   'integration',
            resourceId: existing.id,
            metadata:   { provider: existing.provider },
            traceId:    c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        void syncToolsAndNotifyRelay(tenantId, existing.provider, 'remove');

        return c.json({ ok: true });
    } catch (err: any) {
        console.error('Failed to disconnect integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});

// ── Public OAuth callback ─────────────────────────────────────────────────────
// Mounted separately in publicApi (no auth middleware).
// Google redirects here after the user grants consent.

export const googleOAuthCallbackRoute = new Hono<AppEnv>();

googleOAuthCallbackRoute.get('/google/callback', async (c) => {
    const frontendUrl = process.env.FRONTEND_URL ?? '';
    const fail = (reason: string) =>
        c.redirect(`${frontendUrl}/dashboard/integrations?error=${reason}`);

    const code    = c.req.query('code');
    const stateB64 = c.req.query('state');
    const oauthErr = c.req.query('error');

    // User denied consent
    if (oauthErr || !code || !stateB64) {
        return fail('google_denied');
    }

    // Decode and validate state
    let tenantId: string;
    let userId: string;
    let slug: string;
    let service: 'gmail' | 'drive' | 'calendar';
    try {
        const decoded = JSON.parse(Buffer.from(stateB64, 'base64').toString('utf8')) as {
            tenantId: string;
            userId:   string;
            slug:     string;
            service:  'gmail' | 'drive' | 'calendar';
            ts:       number;
        };
        if (Date.now() - decoded.ts > 600_000) {
            return fail('state_expired');
        }
        if (!['gmail', 'drive', 'calendar'].includes(decoded.service)) {
            return fail('invalid_state');
        }
        tenantId = decoded.tenantId;
        userId   = decoded.userId;
        slug     = decoded.slug;
        service  = decoded.service;
    } catch {
        return fail('invalid_state');
    }

    // Exchange authorization code for tokens
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        return fail('configuration_error');
    }

    let accessToken: string;
    let refreshToken: string;
    let expiresIn: number;

    try {
        const resp = await fetch('https://oauth2.googleapis.com/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id:     clientId,
                client_secret: clientSecret,
                redirect_uri:  redirectUri,
                grant_type:    'authorization_code',
            }),
        });

        if (!resp.ok) {
            console.error('[google/callback] token exchange failed:', resp.status);
            return fail('token_exchange_failed');
        }

        const tokens = await resp.json() as {
            access_token:  string;
            refresh_token?: string;
            expires_in:    number;
            token_type:    string;
        };

        // refresh_token is only issued on first consent or after prompt=consent.
        // If missing here it means the exchange failed silently.
        if (!tokens.access_token || !tokens.refresh_token) {
            console.error('[google/callback] missing tokens in response (no credentials logged)');
            return fail('token_exchange_failed');
        }

        accessToken  = tokens.access_token;
        refreshToken = tokens.refresh_token;
        expiresIn    = tokens.expires_in;
    } catch (err) {
        console.error('[google/callback] fetch error:', (err as Error).message);
        return fail('token_exchange_failed');
    }

    // Encrypt credentials — never store plaintext tokens
    const expiryDate    = Date.now() + expiresIn * 1000;
    const credentialsEnc = encryptCredentials(
        { accessToken, refreshToken, expiresAt: expiryDate },
        tenantId
    );

    // Upsert into integrations table — one row per service (gmail | drive | calendar)
    try {
        await db.execute(sql`
            INSERT INTO integrations
                (tenant_id, provider, mcp_server_url, credentials_enc,
                 status, permissions, created_by)
            VALUES
                (${tenantId}, ${service}, '', ${credentialsEnc},
                 'active', ARRAY[${service}]::text[], ${userId})
            ON CONFLICT (tenant_id, provider)
            DO UPDATE SET
                credentials_enc = EXCLUDED.credentials_enc,
                status          = 'active',
                permissions     = EXCLUDED.permissions,
                updated_at      = NOW()
        `);
    } catch (err) {
        console.error('[google/callback] DB upsert failed:', (err as Error).message);
        return fail('db_error');
    }

    void syncToolsAndNotifyRelay(tenantId, service, 'add');

    return c.redirect(`${frontendUrl}/${slug}/dashboard/integrations?connected=${service}`);
});

// ── Public Jira OAuth callback ────────────────────────────────────────────────
// Mounted separately in publicApi (no auth middleware).
// Atlassian redirects here after the user grants consent.

export const jiraOAuthCallbackRoute = new Hono<AppEnv>();

jiraOAuthCallbackRoute.get('/jira/callback', async (c) => {
    const frontendUrl = process.env.FRONTEND_URL ?? '';
    const fail = (reason: string) =>
        c.redirect(`${frontendUrl}/dashboard/integrations?error=${reason}`);

    const code     = c.req.query('code');
    const stateB64 = c.req.query('state');
    const oauthErr = c.req.query('error');

    if (oauthErr || !code || !stateB64) {
        return fail('jira_denied');
    }

    // Decode and validate state
    let tenantId: string;
    let userId: string;
    let slug: string;
    try {
        const decoded = JSON.parse(Buffer.from(stateB64, 'base64').toString('utf8')) as {
            tenantId: string;
            userId:   string;
            slug:     string;
            ts:       number;
        };
        if (Date.now() - decoded.ts > 600_000) {
            return fail('state_expired');
        }
        tenantId = decoded.tenantId;
        userId   = decoded.userId;
        slug     = decoded.slug;
    } catch {
        return fail('invalid_state');
    }

    // Exchange authorization code for tokens
    // Atlassian token endpoint accepts JSON body.
    const clientId     = process.env.JIRA_CLIENT_ID;
    const clientSecret = process.env.JIRA_CLIENT_SECRET;
    const redirectUri  = process.env.JIRA_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        return fail('configuration_error');
    }

    let accessToken: string;
    let refreshToken: string;
    let expiresIn: number;

    try {
        const resp = await fetch('https://auth.atlassian.com/oauth/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                client_id:     clientId,
                client_secret: clientSecret,
                redirect_uri:  redirectUri,
                grant_type:    'authorization_code',
            }),
        });

        if (!resp.ok) {
            console.error('[jira/callback] token exchange failed:', resp.status);
            return fail('token_exchange_failed');
        }

        const tokens = await resp.json() as {
            access_token:   string;
            refresh_token?: string;
            expires_in:     number;
            token_type:     string;
        };

        if (!tokens.access_token || !tokens.refresh_token) {
            console.error('[jira/callback] missing tokens in response (no credentials logged)');
            return fail('token_exchange_failed');
        }

        accessToken  = tokens.access_token;
        refreshToken = tokens.refresh_token;
        expiresIn    = tokens.expires_in;
    } catch (err) {
        console.error('[jira/callback] fetch error:', (err as Error).message);
        return fail('token_exchange_failed');
    }

    // Encrypt credentials — never store plaintext tokens
    const expiryDate     = Date.now() + expiresIn * 1000;
    const credentialsEnc = encryptCredentials(
        { accessToken, refreshToken, expiresAt: expiryDate },
        tenantId
    );

    try {
        await db.execute(sql`
            INSERT INTO integrations
                (tenant_id, provider, mcp_server_url, credentials_enc,
                 status, permissions, created_by)
            VALUES
                (${tenantId}, 'jira', '', ${credentialsEnc},
                 'active', ARRAY['jira']::text[], ${userId})
            ON CONFLICT (tenant_id, provider)
            DO UPDATE SET
                credentials_enc = EXCLUDED.credentials_enc,
                status          = 'active',
                permissions     = EXCLUDED.permissions,
                updated_at      = NOW()
        `);
    } catch (err) {
        console.error('[jira/callback] DB upsert failed:', (err as Error).message);
        return fail('db_error');
    }

    void syncToolsAndNotifyRelay(tenantId, 'jira', 'add');

    return c.redirect(`${frontendUrl}/${slug}/dashboard/integrations?connected=jira`);
});

// ── Public Zoho OAuth callback ────────────────────────────────────────────────
// Mounted separately in publicApi (no auth middleware).
// Zoho redirects here after the user grants consent.

export const zohoOAuthCallbackRoute = new Hono<AppEnv>();

zohoOAuthCallbackRoute.get('/zoho/callback', async (c) => {
    const frontendUrl = process.env.FRONTEND_URL ?? '';
    const fail = (reason: string) =>
        c.redirect(`${frontendUrl}/dashboard/integrations?error=${reason}`);

    const code     = c.req.query('code');
    const stateB64 = c.req.query('state');
    const oauthErr = c.req.query('error');

    if (oauthErr || !code || !stateB64) {
        return fail('zoho_denied');
    }

    // Decode and validate state
    let tenantId: string;
    let userId: string;
    let slug: string;
    let service: string;
    try {
        const decoded = JSON.parse(Buffer.from(stateB64, 'base64').toString('utf8')) as {
            tenantId: string;
            userId:   string;
            slug:     string;
            service:  string;
            ts:       number;
        };
        if (Date.now() - decoded.ts > 600_000) {
            return fail('state_expired');
        }
        tenantId = decoded.tenantId;
        userId   = decoded.userId;
        slug     = decoded.slug;
        service  = decoded.service;
    } catch {
        return fail('invalid_state');
    }

    // Exchange authorization code for tokens
    const clientId     = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const redirectUri  = process.env.ZOHO_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        return fail('configuration_error');
    }

    let accessToken: string;
    let refreshToken: string;
    let expiresIn: number;

    try {
        const resp = await fetch('https://accounts.zoho.in/oauth/v2/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id:     clientId,
                client_secret: clientSecret,
                redirect_uri:  redirectUri,
                grant_type:    'authorization_code',
            }),
        });

        if (!resp.ok) {
            console.error('[zoho/callback] token exchange failed:', resp.status);
            return fail('token_exchange_failed');
        }

        const tokens = await resp.json() as {
            access_token:   string;
            refresh_token?: string;
            expires_in:     number;
            token_type:     string;
        };

        if (!tokens.access_token || !tokens.refresh_token) {
            console.error('[zoho/callback] missing tokens in response (no credentials logged)');
            return fail('token_exchange_failed');
        }

        accessToken  = tokens.access_token;
        refreshToken = tokens.refresh_token;
        expiresIn    = tokens.expires_in;
    } catch (err) {
        console.error('[zoho/callback] fetch error:', (err as Error).message);
        return fail('token_exchange_failed');
    }

    // Encrypt credentials — never store plaintext tokens
    const expiryDate     = Date.now() + expiresIn * 1000;
    const credentialsEnc = encryptCredentials(
        { accessToken, refreshToken, expiresAt: expiryDate },
        tenantId
    );

    // Map service → permission label (zoho_crm → 'crm', zoho_mail → 'mail', zoho_cliq → 'cliq')
    const zohoPermission: Record<string, string> = {
        zoho_crm:  'crm',
        zoho_mail: 'mail',
        zoho_cliq: 'cliq',
    };
    const permission = zohoPermission[service] ?? service;

    // Upsert — provider=service, permissions=[permission]
    try {
        await db.execute(sql`
            INSERT INTO integrations
                (tenant_id, provider, mcp_server_url, credentials_enc,
                 status, permissions, created_by)
            VALUES
                (${tenantId}, ${service}, '', ${credentialsEnc},
                 'active', ARRAY[${permission}]::text[], ${userId})
            ON CONFLICT (tenant_id, provider)
            DO UPDATE SET
                credentials_enc = EXCLUDED.credentials_enc,
                status          = 'active',
                permissions     = EXCLUDED.permissions,
                updated_at      = NOW()
        `);
    } catch (err) {
        console.error('[zoho/callback] DB upsert failed:', (err as Error).message);
        return fail('db_error');
    }

    void syncToolsAndNotifyRelay(tenantId, service, 'add');

    return c.redirect(`${frontendUrl}/${slug}/dashboard/integrations?connected=${service}`);
});
