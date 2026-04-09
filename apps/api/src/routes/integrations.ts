import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { createCipheriv, scryptSync, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { integrations } from '@serverless-saas/database/schema/integrations';
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
        { id: 'google',  name: 'Google Workspace', type: 'oauth',  description: 'Gmail, Drive, Calendar' },
        { id: 'github',  name: 'GitHub',            type: 'mcp' },
        { id: 'linear',  name: 'Linear',            type: 'mcp' },
        { id: 'slack',   name: 'Slack',             type: 'mcp' },
        { id: 'notion',  name: 'Notion',            type: 'mcp' },
        { id: 'hubspot', name: 'HubSpot',           type: 'mcp' },
        { id: 'zapier',  name: 'Zapier',            type: 'mcp' },
    ];

    return c.json({ data: providers });
});

// POST /integrations/google/connect — generate Google OAuth URL
// Must be defined before /:id to prevent route shadowing.
integrationsRoutes.post('/google/connect', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id as string;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'integrations', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return c.json({ error: 'Google OAuth not configured', code: 'CONFIGURATION_ERROR' }, 500);
    }

    // Embed tenantId + userId in state so the callback can write to the DB.
    // ts guards against replay — validated in the callback (10-minute window).
    const state = Buffer.from(
        JSON.stringify({ tenantId, userId, ts: Date.now() })
    ).toString('base64');

    const scopes = [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
    ];

    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         scopes.join(' '),
        access_type:   'offline',
        prompt:        'consent',
        state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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
    try {
        const decoded = JSON.parse(Buffer.from(stateB64, 'base64').toString('utf8')) as {
            tenantId: string;
            userId:   string;
            ts:       number;
        };
        if (Date.now() - decoded.ts > 600_000) {
            return fail('state_expired');
        }
        tenantId = decoded.tenantId;
        userId   = decoded.userId;
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

    // Upsert into integrations table using raw SQL for ON CONFLICT support
    try {
        await db.execute(`
            INSERT INTO integrations
                (tenant_id, provider, mcp_server_url, credentials_enc,
                 status, permissions, created_by)
            VALUES
                ($1, 'google', '', $2,
                 'active', ARRAY['gmail','drive','calendar'], $3)
            ON CONFLICT (tenant_id, provider)
            DO UPDATE SET
                credentials_enc = EXCLUDED.credentials_enc,
                status          = 'active',
                permissions     = EXCLUDED.permissions,
                updated_at      = NOW()
        ` as any, [tenantId, credentialsEnc, userId]);
    } catch (err) {
        console.error('[google/callback] DB upsert failed:', (err as Error).message);
        return fail('db_error');
    }

    return c.redirect(`${frontendUrl}/dashboard/integrations?connected=google`);
});
