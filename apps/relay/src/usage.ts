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
