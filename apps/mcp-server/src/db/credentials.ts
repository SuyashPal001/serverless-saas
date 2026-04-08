import { neon } from '@neondatabase/serverless';
import { encryptCredentials, decryptCredentials } from '../auth/encryption';

// ── DB client ─────────────────────────────────────────────────────────────────

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is not set');
  return neon(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Integration {
  id: string;
  tenantId: string;
  provider: string;
  mcpServerUrl: string | null;
  credentialsEnc: string;
  status: string;
  permissions: string[];
}

export interface GoogleCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

export interface VendorCredentials {
  apiKey?: string;
  bearerToken?: string;
  [key: string]: unknown;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all connected integrations for a tenant.
 * Used by the gateway during tools/list to build the full tool catalogue.
 */
export async function getIntegrations(tenantId: string): Promise<Integration[]> {
  const db = sql();
  const rows = await db`
    SELECT id, tenant_id, provider, mcp_server_url,
           credentials_enc, status, permissions
    FROM   integrations
    WHERE  tenant_id = ${tenantId}
      AND  status    = 'connected'
  `;

  return rows.map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    provider: r.provider as string,
    mcpServerUrl: r.mcp_server_url as string | null,
    credentialsEnc: r.credentials_enc as string,
    status: r.status as string,
    permissions: (r.permissions as string[]) ?? [],
  }));
}

/**
 * Returns credentials + metadata for a single provider.
 * Throws if no connected integration exists.
 */
export async function getCredentials(
  tenantId: string,
  provider: string
): Promise<{ credentialsEnc: string; mcpServerUrl: string | null; permissions: string[] }> {
  const db = sql();
  const rows = await db`
    SELECT credentials_enc, mcp_server_url, permissions
    FROM   integrations
    WHERE  tenant_id = ${tenantId}
      AND  provider  = ${provider}
      AND  status    = 'connected'
    LIMIT  1
  `;

  if (rows.length === 0) {
    throw new Error(`No connected ${provider} integration for tenant ${tenantId}`);
  }

  return {
    credentialsEnc: rows[0].credentials_enc as string,
    mcpServerUrl: rows[0].mcp_server_url as string | null,
    permissions: (rows[0].permissions as string[]) ?? [],
  };
}

/**
 * Persists refreshed OAuth tokens back to the DB.
 * Called after a successful Google token refresh.
 */
export async function saveRefreshedToken(
  tenantId: string,
  provider: string,
  newCredentials: object
): Promise<void> {
  const encrypted = encryptCredentials(newCredentials, tenantId);
  const db = sql();
  await db`
    UPDATE integrations
    SET    credentials_enc = ${encrypted},
           updated_at      = NOW()
    WHERE  tenant_id = ${tenantId}
      AND  provider  = ${provider}
  `;
}

/**
 * Helper: decrypt and cast to a typed credential object.
 * NEVER log the return value.
 */
export function decryptAs<T>(credentialsEnc: string, tenantId: string): T {
  return decryptCredentials(credentialsEnc, tenantId) as T;
}
