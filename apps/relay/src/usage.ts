import pg from 'pg'

// DDL (run once at deploy time):
//
// CREATE TABLE IF NOT EXISTS usage_records (
//   id          BIGSERIAL PRIMARY KEY,
//   tenant_id   UUID        NOT NULL,
//   actor_id    UUID        NOT NULL,
//   actor_type  TEXT        NOT NULL,   -- 'human' | 'agent'
//   metric      TEXT        NOT NULL,   -- 'messages' | 'input_tokens' | 'output_tokens'
//   quantity    NUMERIC     NOT NULL,
//   api_key_id  UUID,
//   recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
// );

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    pool.on('error', (err) => {
      console.error('[usage] pool error:', err.message)
    })
  }
  return pool
}

export interface UsageRecord {
  tenantId: string
  actorId: string
  apiKeyId?: string
  inputTokens?: number
  outputTokens?: number
}

export interface AgentSkill {
  systemPrompt: string | null
  tools: unknown
  config: unknown
}

export async function fetchAgentSkill(agentId: string): Promise<AgentSkill | null> {
  const p = getPool()
  const res = await p.query<{ system_prompt: string | null; tools: unknown; config: unknown }>(
    `SELECT system_prompt, tools, config FROM agent_skills
     WHERE agent_id = $1 AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [agentId],
  )
  const row = res.rows[0]
  if (!row) return null
  return { systemPrompt: row.system_prompt, tools: row.tools, config: row.config }
}

export async function fetchAgentModelId(agentId: string): Promise<string | null> {
  const p = getPool()
  const agentRes = await p.query<{ llm_provider_id: string | null }>(
    'SELECT llm_provider_id FROM agents WHERE id = $1',
    [agentId],
  )
  const llmProviderId = agentRes.rows[0]?.llm_provider_id ?? null
  if (!llmProviderId) return null
  const provRes = await p.query<{ openclaw_model_id: string }>(
    'SELECT openclaw_model_id FROM llm_providers WHERE id = $1 AND status = \'live\'',
    [llmProviderId],
  )
  return provRes.rows[0]?.openclaw_model_id ?? null
}

export async function fetchAgentSlug(agentId: string): Promise<string | null> {
  // agentId is now the immutable container slug — no DB lookup needed
  return agentId || null
}

export interface QuotaCheckResult {
  allowed: boolean
  used: number
  limit: number | null
  unlimited: boolean
}

export async function checkMessageQuota(tenantId: string): Promise<QuotaCheckResult> {
  const p = getPool()
  try {
    // 1. Active plan — trialing counts the same as active for quota purposes
    const subRes = await p.query<{ plan: string }>(
      `SELECT plan FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('active', 'trialing')
       LIMIT 1`,
      [tenantId],
    )
    const plan = subRes.rows[0]?.plan ?? 'free'

    // 2. Tenant-specific override wins over plan entitlement
    const overrideRes = await p.query<{ value_limit: number | null; unlimited: boolean }>(
      `SELECT tfo.value_limit, tfo.unlimited
       FROM tenant_feature_overrides tfo
       JOIN features f ON f.id = tfo.feature_id
       WHERE tfo.tenant_id = $1
         AND f.key = 'messages'
         AND tfo.revoked_at IS NULL
         AND tfo.deleted_at IS NULL
         AND (tfo.expires_at IS NULL OR tfo.expires_at > NOW())
       LIMIT 1`,
      [tenantId],
    )

    let valueLimit: number | null = null
    let unlimited = false

    if (overrideRes.rows.length > 0) {
      valueLimit = overrideRes.rows[0].value_limit
      unlimited = overrideRes.rows[0].unlimited
    } else {
      const planRes = await p.query<{ value_limit: number | null; unlimited: boolean }>(
        `SELECT pe.value_limit, pe.unlimited
         FROM plan_entitlements pe
         JOIN features f ON f.id = pe.feature_id
         WHERE pe.plan = $1
           AND f.key = 'messages'
           AND f.status = 'active'
         LIMIT 1`,
        [plan],
      )
      if (planRes.rows.length > 0) {
        valueLimit = planRes.rows[0].value_limit
        unlimited = planRes.rows[0].unlimited
      }
    }

    if (unlimited) return { allowed: true, used: 0, limit: null, unlimited: true }

    // 3. Count messages recorded this calendar month
    const usageRes = await p.query<{ used: string }>(
      `SELECT COALESCE(SUM(quantity), 0) AS used
       FROM usage_records
       WHERE tenant_id = $1
         AND metric = 'messages'
         AND recorded_at >= date_trunc('month', NOW())`,
      [tenantId],
    )
    const used = parseInt(usageRes.rows[0]?.used ?? '0', 10)

    if (valueLimit === null) {
      // Missing entitlement config — fail open so quota DB gaps never block users
      console.warn(`[quota] no messages entitlement for tenantId=${tenantId} plan=${plan} — allowing`)
      return { allowed: true, used, limit: null, unlimited: false }
    }

    return { allowed: used < valueLimit, used, limit: valueLimit, unlimited: false }
  } catch (err) {
    // Fail open — a quota DB error must never block a legitimate user request
    console.error('[quota] checkMessageQuota error:', (err as Error).message)
    return { allowed: true, used: 0, limit: null, unlimited: false }
  }
}

export function recordUsage(record: UsageRecord): void {
  const { tenantId, actorId, apiKeyId = null, inputTokens, outputTokens } = record
  const p = getPool()
  const sql = `INSERT INTO usage_records (tenant_id, actor_id, actor_type, metric, quantity, api_key_id)
               VALUES ($1, $2, 'agent', $3, $4, $5)`

  // one row per metric — all fire-and-forget
  p.query(sql, [tenantId, actorId, 'messages', 1, apiKeyId])
    .catch((err: Error) => { console.error('[usage] failed to record messages:', err.message) })

  if (inputTokens !== undefined) {
    p.query(sql, [tenantId, actorId, 'input_tokens', inputTokens, apiKeyId])
      .catch((err: Error) => { console.error('[usage] failed to record input_tokens:', err.message) })
  }

  if (outputTokens !== undefined) {
    p.query(sql, [tenantId, actorId, 'output_tokens', outputTokens, apiKeyId])
      .catch((err: Error) => { console.error('[usage] failed to record output_tokens:', err.message) })
  }
}
