import pg from 'pg'

// ── PM intent routing ────────────────────────────────────────────────────────

const PM_SIGNALS = [
  'create a prd',
  'write a prd',
  'product requirements',
  'prd for',
  'requirements document',
  'i need a prd',
]

export function isPmIntent(msg: string): boolean {
  const lower = msg.toLowerCase()
  return PM_SIGNALS.some(s => lower.includes(s))
}

// ── Draft PRD fetch ──────────────────────────────────────────────────────────

let _pmPool: pg.Pool | null = null

function getPmPool(): pg.Pool {
  if (!_pmPool) {
    _pmPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    _pmPool.on('error', (err) => { console.error('[pm] pool error:', err.message) })
  }
  return _pmPool
}

export async function fetchPrdDraft(
  agentId: string,
  tenantId: string,
): Promise<{ id: string; content: string } | null> {
  const client = await getPmPool().connect()
  try {
    const { rows } = await client.query<{ id: string; content: string }>(
      `SELECT id, content FROM agent_prds
       WHERE agent_id = $1 AND tenant_id = $2 AND status = 'draft'
       ORDER BY updated_at DESC LIMIT 1`,
      [agentId, tenantId],
    )
    return rows[0] ?? null
  } finally {
    client.release()
  }
}
