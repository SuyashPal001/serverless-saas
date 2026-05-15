import { neon } from '@neondatabase/serverless';
import { decryptToken, encryptToken } from '../auth/encryption';

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var not set');
  return neon(url);
}

/**
 * Fetches and decrypts OAuth credentials from the integrations table.
 * Throws if no active integration exists for this tenant + toolkit.
 */
export async function getCredentials(
  tenantId: string,
  toolkit: string
): Promise<OAuthCredentials> {
  const sql = db();
  const rows = await sql`
    SELECT credentials_enc
    FROM integrations
    WHERE tenant_id = ${tenantId}
      AND provider   = ${toolkit}
      AND status     = 'active'
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error(`No active ${toolkit} integration for tenant ${tenantId}`);
  }

  const raw = decryptToken(rows[0].credentials_enc as string, tenantId);
  return JSON.parse(raw) as OAuthCredentials;
}

/**
 * Returns a valid access token, refreshing via Google OAuth if the current
 * token expires within 5 minutes. Persists the new tokens back to Neon.
 */
export async function refreshIfExpired(
  tenantId: string,
  toolkit: string,
  credentials: OAuthCredentials
): Promise<string> {
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  if (Date.now() + FIVE_MINUTES_MS < credentials.expiresAt) {
    return credentials.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars not set');
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    throw new Error(`Google token refresh failed with status ${resp.status}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  const newCredentials: OAuthCredentials = {
    accessToken: data.access_token,
    refreshToken: credentials.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  const encryptedJson = encryptToken(JSON.stringify(newCredentials), tenantId);
  const sql = db();
  await sql`
    UPDATE integrations
    SET credentials_enc = ${encryptedJson},
        updated_at      = NOW()
    WHERE tenant_id = ${tenantId}
      AND provider   = ${toolkit}
  `;

  return newCredentials.accessToken;
}

/**
 * Checks agent_policies for a tenant+agent pair.
 * Returns { blocked, requiresApproval } for the given action.
 * If no policy row exists, the action is permitted.
 */
export async function checkPolicy(
  tenantId: string,
  agentId: string,
  action: string
): Promise<{ blocked: boolean; requiresApproval: boolean }> {
  const sql = db();
  const rows = await sql`
    SELECT allowed_actions, blocked_actions, requires_approval
    FROM agent_policies
    WHERE tenant_id = ${tenantId}
      AND agent_id  = ${agentId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { blocked: false, requiresApproval: false };
  }

  const { blocked_actions, requires_approval } = rows[0] as {
    blocked_actions: string[];
    requires_approval: string[];
  };

  return {
    blocked: blocked_actions.includes(action),
    requiresApproval: requires_approval.includes(action),
  };
}
