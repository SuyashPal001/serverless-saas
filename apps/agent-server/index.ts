import 'dotenv/config'
import express from 'express'
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import pg from 'pg'

const app = express()
app.use(express.json())

const PORT = parseInt(process.env.PORT ?? '3003', 10)
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? ''
const PROVISION_SCRIPT = '/opt/agent-server/provision.sh'
const PORT_START = 19000
const PORT_END = 19999

if (!INTERNAL_SERVICE_KEY) console.warn('[agent-server] WARNING: INTERNAL_SERVICE_KEY not set')
if (!OPENCLAW_GATEWAY_TOKEN) console.warn('[agent-server] WARNING: OPENCLAW_GATEWAY_TOKEN not set')

// ── Bridge port map ──────────────────────────────────────────────────────────
// key: "{tenantId}-{agentSlug}", value: assigned host port
const portMap = new Map<string, number>()
const PORTMAP_FILE = '/opt/agent-server/portmap.json'

function savePortMap(): void {
  try {
    writeFileSync(PORTMAP_FILE, JSON.stringify(Object.fromEntries(portMap), null, 2), 'utf8')
  } catch (err) {
    console.warn('[agent-server] failed to save portmap.json:', (err as Error).message)
  }
}

function loadPortMap(): void {
  try {
    if (!existsSync(PORTMAP_FILE)) return
    const data = JSON.parse(readFileSync(PORTMAP_FILE, 'utf8')) as Record<string, number>
    for (const [key, port] of Object.entries(data)) {
      portMap.set(key, port)
      console.log(`[agent-server] loaded portMap from disk: ${key} → ${port}`)
    }
  } catch (err) {
    console.warn('[agent-server] failed to load portmap.json:', (err as Error).message)
  }
}

function assignPort(key: string): number {
  const used = new Set(portMap.values())
  for (let p = PORT_START; p <= PORT_END; p++) {
    if (!used.has(p)) {
      portMap.set(key, p)
      savePortMap()
      return p
    }
  }
  throw new Error(`No free bridge ports in range ${PORT_START}–${PORT_END}`)
}

function releasePort(key: string): void {
  portMap.delete(key)
  savePortMap()
}

// ── Auth middleware ──────────────────────────────────────────────────────────
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers['x-service-key'] !== INTERNAL_SERVICE_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
})

// ── DB pool (for agentSlug resolution) ──────────────────────────────────────
let pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    pool.on('error', (err: Error) => console.error('[agent-server] db pool error:', err.message))
  }
  return pool
}

async function resolveAgentSlug(agentId?: string): Promise<string> {
  // agentId is now the immutable slug — no DB lookup needed
  return agentId || 'default'
}

function containerName(tenantId: string, agentSlug: string): string {
  return `openclaw-${tenantId}-${agentSlug}`
}

async function fetchSystemPrompt(tenantId: string): Promise<{ systemPrompt: string; tools: string[] }> {
  const res = await getPool().query<{ system_prompt: string | null; tools: string[] | null }>(
    `SELECT ask.system_prompt, ask.tools
     FROM agents a
     LEFT JOIN agent_skills ask ON ask.agent_id = a.id AND ask.status = 'active'
     WHERE a.tenant_id = $1 AND a.status = 'active'
     ORDER BY ask.updated_at DESC NULLS LAST
     LIMIT 1`,
    [tenantId],
  )
  const row = res.rows[0]
  if (!row || !row.system_prompt?.trim()) {
    throw new Error(`No system prompt found for tenant ${tenantId} — provision aborted`)
  }
  const tools = row.tools?.length ? row.tools : ['retrieve_documents']
  if (!tools.includes('retrieve_documents')) tools.unshift('retrieve_documents')
  return { systemPrompt: row.system_prompt.trim(), tools }
}

// ── POST /provision/:tenantId ────────────────────────────────────────────────
// Body: { agentId?: string, agentSlug?: string, identity?: string }
// identity: optional markdown content written to IDENTITY.md before container starts
app.post('/provision/:tenantId', async (req: express.Request, res: express.Response) => {
  const { tenantId } = req.params
  const { agentId, agentSlug: explicitSlug, identity } = req.body as {
    agentId?: string
    agentSlug?: string
    identity?: string
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    res.status(400).json({ error: 'Invalid tenantId — alphanumeric, hyphens, underscores only' })
    return
  }

  const agentSlug = explicitSlug ?? await resolveAgentSlug(agentId)
  const name = containerName(tenantId, agentSlug)
  const portKey = `${tenantId}-${agentSlug}`

  if (explicitSlug || agentId) {
    // ── Single-agent path (explicit slug or agentId provided) ──────────────
    const bridgePort = portMap.has(portKey) ? portMap.get(portKey)! : assignPort(portKey)
    console.log(`[agent-server] provisioning ${name} on port ${bridgePort}`)
    const ocmtDir = `/opt/tenants/${tenantId}/${agentSlug}/workspace`
    let agentTools: string[] = ['retrieve_documents']
    try {
      mkdirSync(ocmtDir, { recursive: true })
      const { systemPrompt: dbPrompt, tools } = await fetchSystemPrompt(tenantId)
      agentTools = tools
      const systemPrompt = identity ?? dbPrompt
      writeFileSync(`${ocmtDir}/IDENTITY.md`, systemPrompt, 'utf8')
      console.log(`[agent-server] wrote IDENTITY.md for ${tenantId}`)
    } catch (err) {
      console.warn(`[agent-server] failed to write IDENTITY.md:`, (err as Error).message)
    }
    try {
      execFileSync(
        PROVISION_SCRIPT,
        [tenantId, INTERNAL_SERVICE_KEY, OPENCLAW_GATEWAY_TOKEN, String(bridgePort), agentSlug, JSON.stringify(agentTools)],
        { stdio: 'pipe' },
      )
      res.json({ ok: true, container: name, agentSlug, bridgePort })
    } catch (err) {
      releasePort(portKey)
      const e = err as Error & { stderr?: Buffer; stdout?: Buffer }
      const detail = e.stderr?.toString().trim() || e.stdout?.toString().trim() || e.message
      console.error(`[agent-server] provision failed for ${name}:`, detail)
      res.status(500).json({ error: 'Provision failed', detail })
    }
  } else {
    // ── Multi-agent path (no slug/agentId — provision all active agents) ───
    let agentRows: { id: string }[] = []
    try {
      const result = await getPool().query<{ id: string }>(
        "SELECT id FROM agents WHERE tenant_id = $1 AND status = 'active'",
        [tenantId],
      )
      agentRows = result.rows
    } catch (err) {
      console.error('[agent-server] failed to query agents:', (err as Error).message)
    }
    const slugs = agentRows.length > 0
      ? agentRows.map(r => r.id).filter(Boolean)
      : ['default']
    const results = []
    for (const slug of slugs) {
      const cName = containerName(tenantId, slug)
      const pKey = `${tenantId}-${slug}`
      const bridgePort = portMap.has(pKey) ? portMap.get(pKey)! : assignPort(pKey)
      console.log(`[agent-server] provisioning ${cName} on port ${bridgePort}`)
      const ocmtDir = `/opt/tenants/${tenantId}/${slug}/workspace`
      let agentTools: string[] = ['retrieve_documents']
      try {
        mkdirSync(ocmtDir, { recursive: true })
        const { systemPrompt, tools } = await fetchSystemPrompt(tenantId)
        agentTools = tools
        writeFileSync(`${ocmtDir}/IDENTITY.md`, systemPrompt, 'utf8')
      } catch (err) {
        console.warn(`[agent-server] failed to write IDENTITY.md for ${slug}:`, (err as Error).message)
      }
      try {
        execFileSync(
          PROVISION_SCRIPT,
          [tenantId, INTERNAL_SERVICE_KEY, OPENCLAW_GATEWAY_TOKEN, String(bridgePort), slug, JSON.stringify(agentTools)],
          { stdio: 'pipe' },
        )
        results.push({ ok: true, container: cName, agentSlug: slug, bridgePort })
      } catch (err) {
        releasePort(pKey)
        const e = err as Error & { stderr?: Buffer; stdout?: Buffer }
        results.push({ ok: false, container: cName, agentSlug: slug, error: e.stderr?.toString().trim() || e.message })
      }
    }
    res.json({ ok: true, results })
  }
})

// ── POST /update/:tenantId/:agentSlug ────────────────────────────────────────
// Updates IDENTITY.md and clears sessions without destroying the container.
// Body: { identity?: string }
// identity: new IDENTITY.md content — if omitted, fetched from DB.
app.post('/update/:tenantId/:agentSlug', async (req: express.Request, res: express.Response) => {
  const { tenantId, agentSlug } = req.params
  const { identity } = req.body as { identity?: string }

  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId) || !/^[a-zA-Z0-9_-]+$/.test(agentSlug)) {
    res.status(400).json({ error: 'Invalid tenantId or agentSlug — alphanumeric, hyphens, underscores only' })
    return
  }

  const workspaceDir = `/opt/tenants/${tenantId}/${agentSlug}/workspace`
  if (!existsSync(workspaceDir)) {
    console.log(`[agent-server] workspace missing for ${tenantId}/${agentSlug} — auto-provisioning`)
    try {
      const provisionResp = await fetch(`http://localhost:${PORT}/provision/${tenantId}`, {
        method: 'POST',
        headers: {
          'x-service-key': INTERNAL_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentSlug, identity }),
      })
      if (!provisionResp.ok) {
        const detail = await provisionResp.text()
        console.error(`[agent-server] auto-provision failed for ${tenantId}/${agentSlug}:`, detail)
        res.status(502).json({ error: 'Auto-provision failed', detail })
        return
      }
      console.log(`[agent-server] auto-provisioned ${tenantId}/${agentSlug}`)
    } catch (err) {
      console.error(`[agent-server] auto-provision error for ${tenantId}/${agentSlug}:`, (err as Error).message)
      res.status(503).json({ error: 'Auto-provision unavailable' })
      return
    }
  }

  // Write new IDENTITY.md — bind mount makes it visible in-container immediately
  try {
    const { systemPrompt: dbPrompt } = await fetchSystemPrompt(tenantId)
    const content = identity ?? dbPrompt
    writeFileSync(`${workspaceDir}/IDENTITY.md`, content, 'utf8')
    console.log(`[agent-server] updated IDENTITY.md for ${tenantId}/${agentSlug}`)
  } catch (err) {
    console.error(`[agent-server] failed to write IDENTITY.md for ${tenantId}/${agentSlug}:`, (err as Error).message)
    res.status(500).json({ error: 'Failed to write IDENTITY.md', detail: (err as Error).message })
    return
  }

  // Clear sessions so the agent picks up the new identity on next conversation
  const sessionsDir = `/opt/tenants/${tenantId}/${agentSlug}/agents/main/sessions`
  try {
    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir)
      for (const file of files) {
        unlinkSync(`${sessionsDir}/${file}`)
      }
      console.log(`[agent-server] cleared ${files.length} session(s) for ${tenantId}/${agentSlug}`)
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.warn(`[agent-server] failed to clear sessions for ${tenantId}/${agentSlug}:`, (err as Error).message)
  }

  // Restart container so it re-reads IDENTITY.md on next session start
  const cName = containerName(tenantId, agentSlug)
  try {
    execFileSync('docker', ['restart', '--time', '2', cName])
    console.log(`[agent-server] restarted container ${cName}`)
  } catch (err) {
    // Non-fatal — container may not exist yet, log and continue
    console.warn(`[agent-server] failed to restart container ${cName}:`, (err as Error).message)
  }

  // Verify container is actually running after restart
  try {
    const out = execFileSync('docker', ['inspect', '--format', '{{.State.Running}}', cName], { encoding: 'utf8' }).trim()
    if (out !== 'true') {
      console.error(`[agent-server] container ${cName} not running after restart`)
      res.status(502).json({ error: 'Container failed to start', container: cName })
      return
    }
  } catch (err) {
    console.warn(`[agent-server] could not verify container ${cName}:`, (err as Error).message)
    // Non-fatal — container may not exist yet for new tenants
  }

  res.json({ ok: true, tenantId, agentSlug, updated: 'IDENTITY.md' })
})

// ── DELETE /destroy/:tenantId/:agentSlug ─────────────────────────────────────
// Query param: ?removeVolume=true to also delete the volume directory on disk.
app.delete('/destroy/:tenantId/:agentSlug', (req: express.Request, res: express.Response) => {
  const { tenantId, agentSlug } = req.params
  const name = containerName(tenantId, agentSlug)

  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId) || !/^[a-zA-Z0-9_-]+$/.test(agentSlug)) {
    res.status(400).json({ error: 'Invalid tenantId or agentSlug — alphanumeric, hyphens, underscores only' })
    return
  }

  const removeVolume = req.query.removeVolume === 'true'

  console.log(`[agent-server] destroying ${name} removeVolume=${removeVolume}`)

  try {
    execFileSync('docker', ['stop', name], { stdio: 'pipe' })
  } catch { /* already stopped — not an error */ }

  try {
    execFileSync('docker', ['rm', name], { stdio: 'pipe' })
  } catch (err) {
    const msg = (err as Error).message
    if (!msg.includes('No such container')) {
      res.status(500).json({ error: 'Failed to remove container', detail: msg })
      return
    }
  }

  releasePort(`${tenantId}-${agentSlug}`)

  if (removeVolume) {
    const volDir = `/opt/tenants/${tenantId}/${agentSlug}`
    try {
      execSync(`rm -rf '${volDir}'`, { stdio: 'pipe' })
      console.log(`[agent-server] removed volume dir ${volDir}`)
    } catch (err) {
      console.warn(`[agent-server] failed to remove volume dir ${volDir}:`, (err as Error).message)
    }
  }

  res.json({ ok: true, container: name, volumeRemoved: removeVolume })
})

// ── GET /status/:tenantId/:agentSlug ─────────────────────────────────────────
app.get('/status/:tenantId/:agentSlug', (req: express.Request, res: express.Response) => {
  const { tenantId, agentSlug } = req.params
  const name = containerName(tenantId, agentSlug)

  try {
    const raw = execFileSync(
      'docker', ['inspect', name, '--format',
        '{{.State.Status}}|{{.State.Health.Status}}|{{(index (index .NetworkSettings.Ports "18789/tcp") 0).HostPort}}',
      ],
      { stdio: 'pipe' },
    )
    const [status, health, hostPort] = raw.toString().trim().split('|')
    const bridgePort = hostPort && hostPort !== '<no value>' ? parseInt(hostPort, 10) : null
    // Keep portMap in sync so /ports endpoint stays accurate
    if (bridgePort) portMap.set(`${tenantId}-${agentSlug}`, bridgePort)
    res.json({ container: name, status, health: health || 'none', bridgePort })
  } catch {
    res.json({ container: name, status: 'not_found', health: 'none', bridgePort: null })
  }
})

// ── GET /ports ────────────────────────────────────────────────────────────────
app.get('/ports', (_req: express.Request, res: express.Response) => {
  res.json(Object.fromEntries(portMap))
})

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ ok: true })
})

// ── POST /reconcile ───────────────────────────────────────────────────────────
// Re-syncs portMap from running Docker containers and returns current state.
app.post('/reconcile', async (_req: express.Request, res: express.Response) => {
  await populatePortMapFromDocker()
  res.json({ ok: true, ports: Object.fromEntries(portMap) })
})

// Restore portMap from already-running openclaw containers so assignPort
// never collides with ports allocated before the last restart.
async function populatePortMapFromDocker(): Promise<void> {
  try {
    const output = execFileSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { stdio: 'pipe' })
    const lines = output.toString().trim().split('\n').filter(Boolean)
    for (const line of lines) {
      const [name, ports] = line.split('\t')
      if (!name?.startsWith('openclaw-')) continue
      // openclaw-{uuid}-{slug}  — UUID is fixed 36-char format
      const m = name.match(/^openclaw-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/)
      if (!m) continue
      const [, tenantId, agentSlug] = m
      // Ports field looks like: "0.0.0.0:19000->18789/tcp, ..."
      const portMatch = ports?.match(/:(\d+)->18789\/tcp/)
      if (!portMatch) continue
      const bridgePort = parseInt(portMatch[1], 10)
      const key = `${tenantId}-${agentSlug}`
      portMap.set(key, bridgePort)
      console.log(`[agent-server] restored portMap: ${key} → ${bridgePort}`)
    }
  } catch (err) {
    console.warn('[agent-server] populatePortMapFromDocker error:', (err as Error).message)
  }
  // Persist the verified-from-Docker state so the next restart loads instantly
  savePortMap()
}

loadPortMap()
populatePortMapFromDocker()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[agent-server] port map ready, listening on :${PORT}`)
    })
  })
  .catch((err) => {
    console.error('[agent-server] failed to populate port map:', (err as Error).message)
    // Start anyway — better to serve with partial map than not start at all
    app.listen(PORT, () => {
      console.log(`[agent-server] listening on :${PORT} (port map may be incomplete)`)
    })
  })
