import 'dotenv/config'
import { randomUUID } from 'crypto'
import express from 'express'
import type { Response } from 'express'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { handleRequest } from './gateway.js'

const PORT = parseInt(process.env.PORT ?? '3002', 10)

const app = express()
app.use(express.json())

// SSE session store: sessionId → { res, tenantId, relaySessionId }
interface SseSession { res: Response; tenantId: string; relaySessionId?: string }
const sseSessions = new Map<string, SseSession>()

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mcp-server', port: PORT, ts: new Date().toISOString() })
})

app.post('/mcp', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string | undefined
  if (!tenantId) {
    res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'x-tenant-id header required' } })
    return
  }
  const relaySessionId = req.headers['x-relay-session-id'] as string | undefined
  const result = await handleRequest(tenantId, req.body, relaySessionId)
  res.json(result)
})

// SSE transport — GET /sse
// OpenClaw connects here (McpServerConfig.url = "http://localhost:3002/sse").
// Headers from McpServerConfig.headers (including x-tenant-id) are sent on every request.
app.get('/sse', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string | undefined
  if (!tenantId) {
    res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'x-tenant-id header required' } })
    return
  }
  const relaySessionId = req.headers['x-relay-session-id'] as string | undefined

  const sessionId = randomUUID()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Tell the client where to POST messages for this session
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)

  sseSessions.set(sessionId, { res, tenantId, relaySessionId })
  console.log(`[mcp-server] SSE session opened sessionId=${sessionId} tenant=${tenantId} relaySessionId=${relaySessionId ?? '(none)'}`)

  req.on('close', () => {
    sseSessions.delete(sessionId)
    console.log(`[mcp-server] SSE session closed sessionId=${sessionId}`)
  })
})

// SSE transport — POST /messages?sessionId=<id>
// Client sends JSON-RPC here; response goes back over the SSE stream.
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId query param required' })
    return
  }

  const session = sseSessions.get(sessionId)
  if (!session) {
    res.status(400).json({ error: `Unknown sessionId: ${sessionId}` })
    return
  }

  try {
    const result = await handleRequest(session.tenantId, req.body, session.relaySessionId)
    session.res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`)
    res.status(202).end()
  } catch (e) {
    const message = (e as Error).message
    console.error(`[mcp-server] SSE dispatch error sessionId=${sessionId}:`, message)
    const errPayload = { jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message } }
    session.res.write(`event: message\ndata: ${JSON.stringify(errPayload)}\n\n`)
    res.status(202).end()
  }
})

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' })
})

async function init() {
  const client = new SecretsManagerClient({ region: 'ap-south-1' })

  const [googleResult, dbResult, tokenKeyResult, serviceKeyResult] = await Promise.allSettled([
    client.send(new GetSecretValueCommand({ SecretId: 'serverless-saas/dev/google-oauth' })),
    client.send(new GetSecretValueCommand({ SecretId: 'serverless-saas/dev/database' })),
    client.send(new GetSecretValueCommand({ SecretId: 'serverless-saas/dev/token-encryption-key' })),
    client.send(new GetSecretValueCommand({ SecretId: 'serverless-saas/dev/internal-service-key' })),
  ])

  if (googleResult.status === 'fulfilled') {
    const secret = JSON.parse(googleResult.value.SecretString ?? '{}')
    process.env.GOOGLE_CLIENT_ID = secret.GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_SECRET = secret.GOOGLE_CLIENT_SECRET
    process.env.GOOGLE_REDIRECT_URI = secret.GOOGLE_REDIRECT_URI
    console.log('[mcp-server] google-oauth secrets loaded')
  } else {
    console.error('[mcp-server] failed to load google-oauth secret — falling back to .env:', (googleResult.reason as Error).message)
  }

  if (dbResult.status === 'fulfilled') {
    const secret = JSON.parse(dbResult.value.SecretString ?? '{}')
    process.env.DATABASE_URL = secret.url
    console.log('[mcp-server] database secret loaded')
  } else {
    console.error('[mcp-server] failed to load database secret — falling back to .env:', (dbResult.reason as Error).message)
  }

  if (tokenKeyResult.status === 'fulfilled') {
    process.env.TOKEN_ENCRYPTION_KEY = tokenKeyResult.value.SecretString ?? ''
    console.log('[mcp-server] token-encryption-key secret loaded')
  } else {
    console.error('[mcp-server] failed to load token-encryption-key secret — falling back to .env:', (tokenKeyResult.reason as Error).message)
  }

  if (serviceKeyResult.status === 'fulfilled') {
    const secret = JSON.parse(serviceKeyResult.value.SecretString ?? '{}')
    process.env.INTERNAL_SERVICE_KEY = secret.key
    console.log('[mcp-server] internal-service-key secret loaded')
  } else {
    console.error('[mcp-server] failed to load internal-service-key secret — falling back to .env:', (serviceKeyResult.reason as Error).message)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[mcp-server] listening on 0.0.0.0:${PORT}`)
  })
}

init()
