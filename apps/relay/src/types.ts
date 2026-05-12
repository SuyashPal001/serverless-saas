import { join } from 'node:path'
import { homedir } from 'node:os'
import { WebSocket } from 'ws'
import { fetchAgentSlug } from './usage.js'

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Attachment {
  fileId?: string
  name?: string
  type?: string
  size?: number
  presignedUrl?: string
}

export interface DownloadedMedia {
  filePath: string
  base64: string
  mimeType: string
  name: string
}

export interface RelaySessionCtx {
  ws: WebSocket
  apiToken: string
  getConversationId: () => string | null
  getPendingUserMessage: () => string
  getPendingAttachments: () => Array<{ fileId?: string; name: string; type: string; size?: number }>
}

export interface TaskStep {
  id: string
  stepOrder: number
  title: string
  description: string
  toolName: string
  parameters: Record<string, unknown>
}

export interface TaskComment {
  id?: string
  content: string
  authorName?: string
  agentId?: string
  createdAt?: string
}

export interface CompletedStep {
  title: string
  agentOutput: string
  results: Array<{ title: string; url: string; description: string }>
  reasoning: string
  summary: string
}

export interface WorkflowStep {
  id?: string
  stepNumber?: number
  title: string
  description?: string
  toolName?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MEDIA_DIR = join(homedir(), '.openclaw', 'media', 'inbound')

export const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL ?? 'http://localhost:3003'
export const AGENT_SERVER_KEY = process.env.AGENT_SERVER_KEY ?? process.env.INTERNAL_SERVICE_KEY ?? ''
export const CONTAINER_MCP_BASE_URL = process.env.CONTAINER_MCP_BASE_URL ?? 'http://host.docker.internal:3002/mcp'

export const API_BASE_URL = process.env.API_BASE_URL ?? ''
export const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? `${API_BASE_URL}/api/v1`

// ─── Shared mutable state ─────────────────────────────────────────────────────

// Session registry (for /agent-response routing)
export const sessions = new Map<string, RelaySessionCtx>()

// Written by /rag/retrieve when it returns chunks; read by the SSE onDone handler.
export const lastRagResult = new Map<string, { chunks: string[]; count: number; ts: number; topScore: number }>()

// MCP write-tool approval state
export const pendingMcpApprovals = new Map<string, { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }>()

// sseApprovalChannels: relay sessionId → function that sends an SSE event on the open stream
export const sseApprovalChannels = new Map<string, (payload: Record<string, unknown>) => void>()

// ─── Rate limiter ─────────────────────────────────────────────────────────────

export const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
export const RATE_LIMIT_MAX = 30        // max requests per window
export const RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute window

export function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────

export const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []),
])

export function getAllowedOrigin(requestOrigin: string | undefined): string {
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin
  return ''
}

// ─── Gateway resolution ───────────────────────────────────────────────────────

export async function resolveGatewayUrl(tenantId: string, agentId: string): Promise<string> {
  console.log(`[gateway] resolveGatewayUrl called tenantId=${JSON.stringify(tenantId)} agentId=${JSON.stringify(agentId)} OPENCLAW_GATEWAY_URL=${process.env.OPENCLAW_GATEWAY_URL ?? '(unset)'}`)
  if (process.env.OPENCLAW_GATEWAY_URL) return process.env.OPENCLAW_GATEWAY_URL
  if (!tenantId) throw new Error('No container found: tenantId is missing')
  const slug = agentId ? await fetchAgentSlug(agentId).catch(() => null) : null
  const agentSlug = slug ?? 'default'
  try {
    const resp = await fetch(`${AGENT_SERVER_URL}/status/${tenantId}/${agentSlug}`, {
      headers: { 'x-service-key': AGENT_SERVER_KEY },
    })
    if (resp.ok) {
      const body = await resp.json() as { bridgePort?: number | null }
      if (body.bridgePort) {
        const url = `ws://localhost:${body.bridgePort}`
        console.log(`[gateway] resolved ${tenantId} → ${url}`)
        return url
      }
    }
  } catch (err) {
    console.warn('[relay] resolveGatewayUrl: agent-server lookup failed:', (err as Error).message)
  }
  if (agentSlug !== 'default') {
    throw new Error(`Agent container not found for tenant=${tenantId} agentSlug=${agentSlug} — refusing to fall back to default container`)
  }
  try {
    console.log(`[gateway] auto-provisioning tenant=${tenantId} agentSlug=${agentSlug}`)
    const provResp = await fetch(`${AGENT_SERVER_URL}/provision/${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-key': AGENT_SERVER_KEY },
      body: JSON.stringify({ agentSlug })
    })
    if (provResp.ok) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const statusResp = await fetch(`${AGENT_SERVER_URL}/status/${tenantId}/${agentSlug}`, {
          headers: { 'x-service-key': AGENT_SERVER_KEY }
        })
        if (statusResp.ok) {
          const body = await statusResp.json() as { bridgePort?: number | null }
          if (body.bridgePort) {
            const url = `ws://localhost:${body.bridgePort}`
            console.log(`[gateway] auto-provision success tenant=${tenantId} → ${url}`)
            return url
          }
        }
      }
    }
  } catch (err) {
    console.error(`[gateway] auto-provision failed tenant=${tenantId}:`, (err as Error).message)
  }
  throw new Error(`No container found for tenant=${tenantId} agentId=${agentId} agentSlug=${agentSlug}`)
}

// ─── Conversation history helpers ─────────────────────────────────────────────

export async function fetchConversationHistory(
  conversationId: string,
  accessToken: string,
  limit = 20
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/conversations/${conversationId}/messages?limit=${limit}&order=asc`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`[history] failed to fetch: ${response.status} body: ${body}`)
      if (response.status === 401) throw new Error('AUTH_EXPIRED')
      return []
    }
    const data = await response.json() as { data?: unknown[]; messages?: unknown[] }
    const messages = (data.data ?? data.messages ?? []) as Array<Record<string, unknown>>
    return messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: typeof msg.content === 'string' ? msg.content : '' }))
  } catch (err) {
    console.error('[history] error fetching:', (err as Error).message)
    return []
  }
}

export function formatHistoryForContext(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (history.length === 0) return ''
  const formatted = history.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n\n')
  return `<conversation_history>\n${formatted}\n</conversation_history>\n\n`
}
