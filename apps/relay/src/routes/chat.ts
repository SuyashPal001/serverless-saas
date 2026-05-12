import { Hono } from 'hono'
import { RequestContext, MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context'
import type { AuthPayload } from '../auth.js'
import { validateToken } from '../auth.js'
import { checkMessageQuota, fetchWorkingMemory } from '../usage.js'
import { saveUserMessage, saveAssistantMessage } from '../persistence.js'
import { downloadMediaAttachment } from '../media.js'
import { fireMetrics, fireAutoEval, fireToolCallLog, fireKnowledgeGap } from '../events.js'
import { platformAgent } from '../mastra/index.js'
import { getMCPClientForTenant } from '../mastra/tools.js'
import { getThinkingBudget } from '../mastra/thinking.js'
import { filterPII } from '../pii-filter.js'
import {
  Attachment, DownloadedMedia,
  getAllowedOrigin, INTERNAL_SERVICE_KEY, API_BASE_URL,
  sseApprovalChannels, lastRagResult,
  checkRateLimit,
} from '../types.js'

// ─── SSE chat endpoint ────────────────────────────────────────────────────────

export const chatRouter = new Hono()

chatRouter.options('/api/chat', (c) => {
  const origin = getAllowedOrigin(c.req.header('Origin'))
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Id-Token, Accept',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    },
  })
})

chatRouter.post('/api/chat', async (c) => {
  // 1. Auth — same JWT validation as WebSocket upgrade
  const serviceKey = c.req.header('X-Service-Key') ?? ''
  const isInternalCall = serviceKey !== '' && serviceKey === INTERNAL_SERVICE_KEY

  let payload: AuthPayload
  let idToken = ''

  if (isInternalCall) {
    // Internal Lambda bypass — skip Cognito validation
    // tenantId must be in request body; parsed below
    payload = {
      sub: 'internal-service',
      email: 'internal@service',
      'custom:tenantId': '',  // overwritten after body parse
    } as AuthPayload
  } else {
    const authHeader = c.req.header('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    // idToken used for API persistence calls
    idToken = c.req.header('X-Id-Token') ?? token

    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    try {
      payload = await validateToken(token)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
  // 2a. Rate limit — per authenticated user
  const rateLimitUserId = payload.sub ?? payload['cognito:username'] ?? 'unknown'
  if (!checkRateLimit(rateLimitUserId)) {
    return c.json({ error: 'Too many requests. Please wait a moment.' }, 429)
  }
  // 2. Parse + validate body
  let body: { conversationId?: unknown; message?: unknown; attachments?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments : []
  const agentId = typeof (body as Record<string, unknown>).agentId === 'string' ? (body as Record<string, unknown>).agentId as string : ''
  const bodyTenantId = typeof (body as Record<string, unknown>).tenantId === 'string'
    ? (body as Record<string, unknown>).tenantId as string
    : ''

  if (!conversationId || !rawMessage) {
    return c.json({ error: 'conversationId and message are required' }, 400)
  }

  const { sanitized: message, detections: chatPiiDetections } = filterPII(rawMessage)
  if (chatPiiDetections.length > 0) {
    console.log(`[pii-filter] chat userId=${payload.sub} masked: ${chatPiiDetections.map(d => `${d.type}×${d.count}`).join(' ')}`)
  }

  const userId = payload.sub
  let internalUserId: string = userId

  if (!isInternalCall) {
    try {
      const meResp = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      })
      if (meResp.ok) {
        const me = await meResp.json() as { id?: string }
        if (typeof me.id === 'string' && me.id) internalUserId = me.id
      } else {
        console.warn(`[sse] auth/me returned ${meResp.status} — falling back to Cognito sub`)
      }
    } catch (err) {
      console.warn('[sse] auth/me fetch failed — falling back to Cognito sub:', (err as Error).message)
    }
  }
  const tenantId = isInternalCall
    ? (bodyTenantId || (payload['custom:tenantId'] ?? userId))
    : (payload['custom:tenantId'] ?? userId)

  if (isInternalCall && !tenantId) {
    return c.json({ error: 'tenantId required for internal service calls' }, 400)
  }

  // Quota guard — skip for internal service calls (Lambda-initiated, not user-facing).
  // Checked before ReadableStream setup so we can still return a plain 429, not an SSE error event.
  if (!isInternalCall) {
    const chatQuota = await checkMessageQuota(tenantId)
    if (!chatQuota.allowed) {
      console.warn(`[sse] tenantId=${tenantId} userId=${userId} quota exceeded used=${chatQuota.used} limit=${chatQuota.limit}`)
      return c.json({ error: 'Message quota exceeded', used: chatQuota.used, limit: chatQuota.limit }, 429)
    }
  }

  const sessionId = crypto.randomUUID()

  console.log(`[sse:${sessionId}] user=${userId} conversationId=${conversationId}`)

  // Instrumentation state — scoped per request
  const startTime = Date.now()
  let ragFired = false
  let ragChunksRetrieved = 0
  let ragChunks: string[] = []
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let costUsd: number | undefined
  // Deferred metrics payload — populated in onDone, fired in onTokens (or fallback timeout)
  let pendingMetrics: Parameters<typeof fireMetrics>[0] | null = null
  let pendingEval: Parameters<typeof fireAutoEval>[0] | null = null

  const flushMetrics = (): void => {
    if (pendingMetrics) { fireMetrics(pendingMetrics); pendingMetrics = null }
    if (pendingEval) { fireAutoEval(pendingEval); pendingEval = null }
  }

  // 3. Set up SSE ReadableStream
  const encoder = new TextEncoder()
  let streamClosed = false
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const sendEvent = (event: string, data: object): void => {
    if (streamClosed) return
    try {
      streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // enqueue after close — swallow
    }
  }

  const closeStream = (): void => {
    if (streamClosed) return
    streamClosed = true
    sseApprovalChannels.delete(sessionId)
    try { streamController.close() } catch {}
  }

  sseApprovalChannels.set(sessionId, (payload) => sendEvent('approval_request', payload))

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    cancel() {
      console.log(`[sse:${sessionId}] client disconnected`)
      streamClosed = true
      sseApprovalChannels.delete(sessionId)
    },
  })

  // 4. Async handler — runs concurrently while response is streaming
  ;(async () => {
    let mcpClient: ReturnType<typeof getMCPClientForTenant> | null = null
    try {
      const workingMemory = await fetchWorkingMemory(tenantId)
      const memPreamble = workingMemory
        ? `[AGENT MEMORY]\nYou have remembered the following about this tenant from previous sessions:\n${workingMemory}\n\n`
        : ''
      if (workingMemory) console.log(`[sse:${sessionId}] injected working memory tenantId=${tenantId}`)

      const sessionCtx = `<session_context>\ntenant_id: ${tenantId}\n</session_context>\n\n`

      const mediaAttachments = attachments.filter(
        (a) =>
          a.type?.startsWith('image/') ||
          a.type?.startsWith('video/') ||
          a.type?.startsWith('audio/') ||
          a.type === 'application/pdf' ||
          a.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )

      type ContentPart =
        | { type: 'text'; text: string }
        | { type: 'image'; image: string; mimeType: string }

      let mastraMessage: string | { role: 'user'; content: ContentPart[] }

      if (mediaAttachments.length > 0) {
        const downloaded = (await Promise.all(
          mediaAttachments.map((a) => downloadMediaAttachment(a, sessionId))
        ))
          .filter((d): d is DownloadedMedia | DownloadedMedia[] => d !== null)
          .flatMap(d => Array.isArray(d) ? d : [d])

        const textDocs = downloaded.filter(d => d.mimeType === 'text/plain')
        const imageFiles = downloaded.filter(d => d.mimeType !== 'text/plain')

        let finalMessage = memPreamble + sessionCtx + message
        for (const doc of textDocs) {
          const text = Buffer.from(doc.base64.replace(/^data:text\/plain;base64,/, ''), 'base64').toString('utf8')
          finalMessage = `[File: ${doc.name} | path: ${doc.filePath}]\n${text}\n\n${finalMessage}`
        }

        console.log(`[sse:${sessionId}] ${imageFiles.length} image attachment(s), ${textDocs.length} doc(s) injected into message`)

        if (imageFiles.length > 0) {
          const parts: ContentPart[] = imageFiles.map(img => ({
            type: 'image' as const,
            image: img.base64.replace(/^data:[^;]+;base64,/, ''),
            mimeType: img.mimeType,
          }))
          parts.push({ type: 'text', text: finalMessage })
          mastraMessage = { role: 'user', content: parts }
        } else {
          mastraMessage = finalMessage
        }
      } else {
        mastraMessage = memPreamble + sessionCtx + message
      }

      if (streamClosed) return

      const requestContext = new RequestContext()
      requestContext.set(MASTRA_RESOURCE_ID_KEY, tenantId)
      requestContext.set(MASTRA_THREAD_ID_KEY, conversationId)
      requestContext.set('tenantId', tenantId)
      requestContext.set('agentId', agentId)
      mcpClient = getMCPClientForTenant(tenantId)
      requestContext.set('__mcpClient', mcpClient as any)

      const thinkingBudget = getThinkingBudget(message)
      console.log(`[sse:${sessionId}] streaming via platformAgent tenantId=${tenantId} conversationId=${conversationId} thinkingBudget=${thinkingBudget}`)

      const agentStream = await (platformAgent as any).stream(mastraMessage, {
        memory: { thread: conversationId || crypto.randomUUID(), resource: tenantId },
        requestContext,
        providerOptions: { google: { thinkingConfig: { thinkingBudget } } },
      })

      let fullText = ''

      for await (const part of agentStream.fullStream as AsyncIterable<any>) {
        if (streamClosed) break
        switch (part.type) {
          case 'text-delta': {
            const text = (part.payload?.text ?? part.textDelta ?? '') as string
            fullText += text
            sendEvent('delta', { text, conversationId })
            break
          }
          case 'tool-call': {
            const p = part.payload ?? part
            const toolName = (p.toolName ?? '') as string
            const args = (p.args ?? {}) as Record<string, unknown>
            const toolCallId = (p.toolCallId ?? toolName) as string
            sendEvent('tool_call', { toolName, toolCallId, args, conversationId })
            if (toolName === 'retrieve_documents') ragFired = true
            fireToolCallLog({
              tenantId, conversationId, userId: internalUserId,
              toolName, success: true, latencyMs: Date.now() - startTime, args,
            })
            break
          }
          case 'finish': {
            const usage = part.payload?.output?.usage ?? part.usage
            inputTokens = (usage?.promptTokens as number | undefined) ?? 0
            outputTokens = (usage?.completionTokens as number | undefined) ?? 0
            totalTokens = inputTokens + outputTokens
            break
          }
        }
      }

      const messageId = crypto.randomUUID()
      const responseTimeMs = Date.now() - startTime

      const cached = lastRagResult.get(tenantId)
      if (cached && Date.now() - cached.ts < 60_000) {
        ragFired = true
        ragChunksRetrieved = cached.count
        ragChunks = cached.chunks
      }
      if (ragFired && (ragChunksRetrieved === 0 || (cached && cached.topScore < 0.5))) {
        fireKnowledgeGap({ tenantId, conversationId, query: message, ragScore: cached?.topScore ?? 0 })
      }

      sendEvent('done', { text: fullText, conversationId, messageId })

      const atts = attachments.map(a => ({
        fileId: a.fileId,
        name: a.name ?? a.fileId ?? 'attachment',
        type: a.type ?? '',
        size: a.size,
      }))
      saveUserMessage(idToken, conversationId, message, atts)
      saveAssistantMessage(idToken, conversationId, fullText)

      pendingMetrics = {
        conversationId, tenantId, ragFired, ragChunksRetrieved,
        responseTimeMs, totalTokens, inputTokens, outputTokens,
        userMessageCount: 1, costUsd,
      }
      if (ragFired) {
        pendingEval = {
          conversationId, messageId, tenantId,
          question: message, retrievedChunks: ragChunks, answer: fullText,
        }
      }
      flushMetrics()
      closeStream()
    } catch (err) {
      const errMsg = (err as Error).message
      console.error(`[sse:${sessionId}] fatal error:`, errMsg)
      sendEvent('error', { message: 'Internal server error', conversationId })
      closeStream()
    } finally {
      // mcpClient is now a persistent singleton per tenant — do not disconnect
    }
  })()

  const origin = getAllowedOrigin(c.req.header('Origin'))
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    },
  })
})
