import 'dotenv/config'
import type { Server } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { serve } from '@hono/node-server'
import { WebSocketServer, WebSocket, RawData } from 'ws'
import { app, API_BASE_URL, resolveGatewayUrl, downloadMediaAttachment, fireToolCallLog, sessions } from './app.js'
import type { RelaySessionCtx, DownloadedMedia } from './app.js'
import { validateToken } from './auth.js'
import { OpenClawClient } from './openclaw.js'
import { createConversation, saveUserMessage, saveAssistantMessage } from './persistence.js'
import { fetchAgentModelId } from './usage.js'
import { filterPII } from './pii-filter.js'

// WebSocket server — noServer mode; upgrade events wired below
const wss = new WebSocketServer({ noServer: true })

async function handleSession(
  ws: WebSocket,
  userId: string,
  internalUserId: string,
  email: string | undefined,
  sessionId: string,
  idToken: string,
  tenantId: string,
): Promise<void> {
  const apiToken = idToken
  let pendingUserMessage = ''
  let pendingAttachments: Array<{ fileId?: string; name: string; type: string; size?: number }> = []
  let conversationId: string | null = null
  let resolveReady!: () => void
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve })
  let firstMessage = true
  let deltasSent = 0
  let deltaBuffer = ''
  let approvalIntercepted = false

  let gatewayUrl: string
  try {
    gatewayUrl = await resolveGatewayUrl(tenantId, '')
  } catch (err) {
    console.error(`[session:${sessionId}] resolveGatewayUrl failed:`, (err as Error).message)
    ws.send(JSON.stringify({ type: 'error', message: 'Agent not ready. Please try again.' }))
    ws.close()
    return
  }
  const openClaw = new OpenClawClient({
    tenantId,
    gatewayUrl,
    onDelta(text: string) {
      deltaBuffer += text
      // Check if accumulated buffer contains an approval request from the agent
      const approveMatch = deltaBuffer.match(/\/approve\s+(\S+)\s+allow-once/)
      if (approveMatch && !approvalIntercepted) {
        approvalIntercepted = true
        const approvalId = approveMatch[1]
        console.log(`[session:${sessionId}] intercepted approval_request id=${approvalId}`)
        ws.send(JSON.stringify({
          type: 'approval_request',
          approvalId,
          toolName: 'tool_call',
          description: 'Agent wants to run a tool. Approve or dismiss.',
          arguments: {},
          conversationId,
        }))
        return
      }
      if (!approvalIntercepted) {
        deltasSent++
        ws.send(JSON.stringify({ type: 'delta', text, conversationId }))
      }
    },
    onDone(fullText: string) {
      const approveMatch = fullText.match(/\/approve\s+(\S+)\s+allow-once/)
      if (approveMatch) {
        const approvalId = approveMatch[1]
        // Only emit if onDelta didn't already intercept this turn
        if (!approvalIntercepted) {
          console.log(`[session:${sessionId}] intercepted approval_request (via onDone) id=${approvalId}`)
          ws.send(JSON.stringify({
            type: 'approval_request',
            approvalId,
            toolName: 'exec',
            description: 'Agent wants to run a tool. Approve or dismiss.',
            arguments: {},
            conversationId,
          }))
        }
        // Always reset so the next turn (agent reply after tool runs) flows normally
        deltaBuffer = ''
        approvalIntercepted = false
        deltasSent = 0
        return
      }
      const userMsg = pendingUserMessage
      pendingUserMessage = ''
      deltaBuffer = ''
      console.log(`[session:${sessionId}] onDone conversationId=${conversationId} userMsg length=${userMsg.length} approvalIntercepted=${approvalIntercepted}`)
      // If this turn was an approval request, swallow the done event — the frontend is
      // waiting for the user to approve/dismiss, not for a streamed response.
      if (approvalIntercepted) {
        approvalIntercepted = false
        deltasSent = 0
        return
      }
      // NO_REPLY is sent by the agent when it responds via TTS only — no text to surface
      if (fullText === 'NO_REPLY') {
        pendingAttachments = []
        return
      }
      // If no delta events were sent (e.g. TTS-only path), push the full text as a delta
      // so frontends that build display from delta events still show the response
      if (deltasSent === 0) {
        ws.send(JSON.stringify({ type: 'delta', text: fullText, conversationId }))
      }
      deltasSent = 0
      ws.send(JSON.stringify({ type: 'done', text: fullText, conversationId }))
      if (conversationId) {
        saveUserMessage(apiToken, conversationId, userMsg, pendingAttachments)
        pendingAttachments = []
        saveAssistantMessage(apiToken, conversationId, fullText)
      }
    },
    onClose() {
      ws.close()
    },
    onError(err: Error) {
      console.error(`[session:${sessionId}] openclaw error:`, err.message)
      ws.send(JSON.stringify({ type: 'error', message: 'Gateway error', conversationId }))
      ws.close()
    },
    onSendError(err: Error) {
      console.error(`[session:${sessionId}] chat.send rejected:`, err.message)
      pendingUserMessage = ''
      pendingAttachments = []
      ws.send(JSON.stringify({ type: 'done', text: `Sorry, I couldn't process that attachment. ${err.message}`, conversationId }))
    },
    onToolCall(tool: string, args: Record<string, unknown>, callId?: string, isError?: boolean, errorMessage?: string) {
      ws.send(JSON.stringify({ type: 'tool_call', tool, args, conversationId }))
      fireToolCallLog({ tenantId, conversationId: conversationId ?? '', userId: internalUserId, toolName: tool, success: !isError, latencyMs: 0, args, errorMessage })
    },
  })

  sessions.set(sessionId, {
    ws,
    apiToken,
    getConversationId: () => conversationId,
    getPendingUserMessage: () => pendingUserMessage,
    getPendingAttachments: () => pendingAttachments,
  })

  const connectPromise = openClaw.connect()
  connectPromise.then(() => {
    console.log(`[session:${sessionId}] user=${userId} (${email ?? 'no email'}) connected`)
  }).catch((err: Error) => {
    console.error(`[session:${sessionId}] openclaw connect failed:`, err.message)
    ws.send(JSON.stringify({ type: 'error', message: 'Gateway unavailable' }))
    ws.close()
  })

  ws.on('message', (data: RawData) => {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(data.toString()) as Record<string, unknown>
    } catch {
      return
    }

    // Handle approval/dismiss responses from the frontend
    if (body.type === 'approve' || body.type === 'dismiss') {
      const approvalId = typeof body.approvalId === 'string' ? body.approvalId.trim() : ''
      if (!approvalId) {
        console.warn(`[session:${sessionId}] ${body.type} received without approvalId`)
        return
      }
      if (body.type === 'approve') {
        console.log(`[session:${sessionId}] approve approvalId=${approvalId}`)
        openClaw.resolveApproval(approvalId, 'allow-once')
      } else {
        console.log(`[session:${sessionId}] dismiss approvalId=${approvalId}`)
        openClaw.resolveApproval(approvalId, 'deny')
      }
      return
    }

    const rawWsMessage = typeof body.message === 'string' ? body.message.trim() : ''
    console.log(`[session:${sessionId}] raw body:`, JSON.stringify(body))
    console.log(`[session:${sessionId}] firstMessage=${firstMessage} message=${JSON.stringify(rawWsMessage)} agentId=${typeof body.agentId === 'string' ? body.agentId : '(missing)'}`)
    const attachments0 = Array.isArray(body.attachments) ? body.attachments : []
    if (!rawWsMessage && attachments0.length === 0) return
    const { sanitized: filteredWsMsg, detections: wsPiiDetections } = filterPII(rawWsMessage)
    if (wsPiiDetections.length > 0) {
      console.log(`[pii-filter] ws sessionId=${sessionId} masked: ${wsPiiDetections.map(d => `${d.type}×${d.count}`).join(' ')}`)
    }
    let effectiveMessage = filteredWsMsg || '[voice message]'
    const agentId = typeof body.agentId === 'string' ? body.agentId : ''
    const attachments = attachments0
    if (attachments.length > 0) {
      console.log('[debug] attachments received:', JSON.stringify(
        attachments.map((a: Record<string, unknown>) => ({
          name: a.name,
          type: a.type,
          hasPresignedUrl: !!a.presignedUrl,
          presignedUrlPrefix: typeof a.presignedUrl === 'string' ? a.presignedUrl.slice(0, 50) : null
        }))
      ))
    }
    if (firstMessage) {
      firstMessage = false
      if (agentId) openClaw.setActorId(agentId)
      const incomingConversationId = body.conversationId as string | undefined
      const modelFetch = agentId
        ? fetchAgentModelId(agentId).catch((err: Error) => {
            console.error(`[session:${sessionId}] fetchAgentModelId error:`, err.message)
            return null
          })
        : Promise.resolve(null)

      const applyModelOverride = (modelId: string | null): void => {
        if (modelId) {
          console.log(`[session] model override: ${modelId}`)
          openClaw.patchSessionModel(modelId)
        } else {
          console.log('[session] using default model')
        }
      }

      if (incomingConversationId) {
        console.log(`[session:${sessionId}] continuing existing conversation ${incomingConversationId}`)
        conversationId = incomingConversationId
        Promise.all([connectPromise, modelFetch]).then(([, modelId]) => {
          applyModelOverride(modelId)
          console.log(`[session:${sessionId}] readyPromise resolved`)
          resolveReady()
          ws.send(JSON.stringify({ type: 'ready', conversationId }))
        }).catch((err: Error) => {
          console.error(`[session:${sessionId}] session setup failed:`, err?.message)
          resolveReady()
          ws.send(JSON.stringify({ type: 'error', message: 'Session setup failed', conversationId }))
          ws.close()
        })
      } else {
        console.log(`[session:${sessionId}] creating new conversation`)
        Promise.all([
          connectPromise,
          createConversation(apiToken, agentId).then((id) => {
            conversationId = id
            console.log(`[session:${sessionId}] createConversation result conversationId=${id}`)
          }),
          modelFetch,
        ]).then(([, , modelId]) => {
          applyModelOverride(modelId)
          console.log(`[session:${sessionId}] readyPromise resolved`)
          resolveReady()
          ws.send(JSON.stringify({ type: 'ready', conversationId }))
        }).catch((err: Error) => {
          console.error(`[session:${sessionId}] session setup failed:`, err?.message)
          resolveReady()
          ws.send(JSON.stringify({ type: 'error', message: 'Session setup failed', conversationId }))
          ws.close()
        })
      }
    }
    readyPromise.then(async () => {
      pendingUserMessage = effectiveMessage
      pendingAttachments = (attachments as Array<{ fileId?: string; name: string; type: string; size?: number }>)
        .map(({ fileId, name, type, size }) => ({ fileId, name: name ?? fileId ?? 'attachment', type: type ?? '', size }))
      if (!userId) {
        console.error('[session] missing userId — cannot establish per-user session key')
        ws.close()
        return
      }
      const ocSessionKey = conversationId
        ? `agent:main:direct:${userId.toLowerCase()}:${conversationId}`
        : `agent:main:direct:${userId.toLowerCase()}`

      const sessionContext = `<session_context>\ntenant_id: ${tenantId}\n</session_context>\n\n`
      effectiveMessage = sessionContext + effectiveMessage

      const mediaAttachments = attachments.filter(
        (a: any) =>
          a.type?.startsWith('image/') ||
          a.type?.startsWith('video/') ||
          a.type?.startsWith('audio/') ||
          a.type === 'application/pdf' ||
          a.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      if (mediaAttachments.length > 0) {
        const downloaded = (await Promise.all(
          mediaAttachments.map((a: any) => downloadMediaAttachment(a, sessionId))
        ))
          .filter((d): d is DownloadedMedia | DownloadedMedia[] => d !== null)
          .flatMap(d => Array.isArray(d) ? d : [d])
        // text/plain (extracted from PDF/DOCX) must be injected into the message —
        // OpenClaw only forwards image/* attachments to Claude; text/plain is dropped
        const textDocs = downloaded.filter(d => d.mimeType === 'text/plain')
        const imageAttachments = downloaded
          .filter(d => d.mimeType !== 'text/plain')
          .map(d => ({ name: d.name, mimeType: d.mimeType, content: d.base64 }))
        let finalMessage = effectiveMessage
        for (const doc of textDocs) {
          const text = Buffer.from(doc.base64.replace(/^data:text\/plain;base64,/, ''), 'base64').toString('utf8')
          finalMessage = `[File: ${doc.name} | path: ${doc.filePath}]\n${text}\n\n${finalMessage}`
        }
        console.log(`[session:${sessionId}] sending ${imageAttachments.length} image attachment(s), ${textDocs.length} doc(s) injected into message`)
        openClaw.sendMessage(finalMessage, imageAttachments, ocSessionKey)
      } else {
        openClaw.sendMessage(effectiveMessage, [], ocSessionKey)
      }
    })
  })

  ws.on('close', () => {
    sessions.delete(sessionId)
    openClaw.close()
    console.log(`[session:${sessionId}] closed`)
  })
}

const port = Number(process.env.PORT ?? 3001)

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`agent-relay listening on port ${port}`)
}) as unknown as Server

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const url = new URL(req.url ?? '/', `http://localhost`)

  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }

  const token = url.searchParams.get('token') ?? ''
  const idToken = url.searchParams.get('idToken') ?? ''

  if (!idToken) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
    socket.destroy()
    return
  }

  validateToken(token).then(async (payload) => {
    const userId = payload.sub
    const email = payload.email
    const tenantId = payload['custom:tenantId'] ?? userId
    const sessionId = crypto.randomUUID()
    console.log('[session] tenantId from JWT:', tenantId)

    let internalUserId: string = userId
    try {
      const meResp = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      })
      if (meResp.ok) {
        const me = await meResp.json() as { id?: string }
        if (typeof me.id === 'string' && me.id) internalUserId = me.id
      } else {
        console.warn(`[session] auth/me returned ${meResp.status} — falling back to Cognito sub`)
      }
    } catch (err) {
      console.warn('[session] auth/me fetch failed — falling back to Cognito sub:', (err as Error).message)
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      handleSession(ws, userId, internalUserId, email, sessionId, idToken, tenantId).catch((err: Error) => {
        console.error('[session] handleSession error:', err.message)
        ws.close()
      })
    })
  }).catch(() => {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
    socket.destroy()
  })
})
