import pg from 'pg'
import { encryptCredentials, decryptCredentials } from '../auth/encryption.js'

const { Pool } = pg

let _pool: pg.Pool | null = null

function pool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL })
    _pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message)
    })
  }
  return _pool
}

export interface Integration {
  id: string
  tenant_id: string
  provider: string
  mcp_server_url: string | null
  status: string
  permissions: string[]
  created_by: string
  created_at: Date
  updated_at: Date
}

export interface DecryptedIntegration extends Integration {
  credentials: Record<string, unknown>
}

/** Fetch all active integrations for a tenant */
export async function getIntegrations(tenantId: string): Promise<Integration[]> {
  const { rows } = await pool().query<Integration>(
    `SELECT id, tenant_id, provider, mcp_server_url, status, permissions,
            created_by, created_at, updated_at
     FROM integrations
     WHERE tenant_id = $1 AND status = 'active'
     ORDER BY created_at`,
    [tenantId]
  )
  return rows
}

/** Fetch a single integration including decrypted credentials */
export async function getIntegrationWithCredentials(
  tenantId: string,
  provider: string
): Promise<DecryptedIntegration | null> {
  const { rows } = await pool().query<Integration & { credentials_enc: string | null }>(
    `SELECT id, tenant_id, provider, mcp_server_url, credentials_enc,
            status, permissions, created_by, created_at, updated_at
     FROM integrations
     WHERE tenant_id = $1 AND provider = $2 AND status = 'active'
     LIMIT 1`,
    [tenantId, provider]
  )
  if (rows.length === 0) return null
  const row = rows[0]
  let credentials: Record<string, unknown> = {}
  if (row.credentials_enc) {
    try {
      credentials = decryptCredentials(row.credentials_enc, tenantId) as Record<string, unknown>
    } catch (err) {
      console.error(`[db] failed to decrypt credentials for ${provider}/${tenantId}:`, (err as Error).message)
    }
  }
  const { credentials_enc: _enc, ...rest } = row as typeof row & { credentials_enc?: string }
  void _enc
  return { ...rest, credentials }
}

/** Upsert an integration row, encrypting the credentials */
export async function upsertIntegration(params: {
  tenantId: string
  provider: string
  credentials: Record<string, unknown>
  mcpServerUrl?: string
  permissions?: string[]
  createdBy: string
}): Promise<string> {
  const enc = encryptCredentials(params.credentials, params.tenantId)
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO integrations
       (tenant_id, provider, mcp_server_url, credentials_enc, status, permissions, created_by, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, NOW())
     ON CONFLICT (tenant_id, provider)
     DO UPDATE SET
       credentials_enc = EXCLUDED.credentials_enc,
       mcp_server_url  = COALESCE(EXCLUDED.mcp_server_url, integrations.mcp_server_url),
       permissions     = EXCLUDED.permissions,
       status          = 'active',
       updated_at      = NOW()
     RETURNING id`,
    [
      params.tenantId,
      params.provider,
      params.mcpServerUrl ?? null,
      enc,
      params.permissions ?? [],
      params.createdBy,
    ]
  )
  return rows[0].id
}

/** Soft-delete an integration */
export async function revokeIntegration(tenantId: string, provider: string): Promise<void> {
  await pool().query(
    `UPDATE integrations SET status = 'revoked', updated_at = NOW()
     WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  )
}
