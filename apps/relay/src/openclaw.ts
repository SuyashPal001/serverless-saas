import WebSocket from 'ws'
import { randomUUID, sign as cryptoSign } from 'crypto'
import { readFileSync } from 'fs'
import { recordUsage } from './usage.js'

export interface OpenClawClientOptions {
  onDelta: (text: string) => void   // incremental new chars only
  onDone: (fullText: string) => void
  onClose: () => void
  onError: (err: Error) => void
  onSendError?: (err: Error) => void  // chat.send rejected (e.g. attachment too large) — keep session open
  onToolCall?: (tool: string, args: Record<string, unknown>, callId?: string, isError?: boolean, errorMessage?: string) => void
  onToolCallStart?: (tool: string, args: Record<string, unknown>, callId?: string) => void
  onTokens?: (input: number, output: number, costUsd?: number) => void
  tenantId?: string
  actorId?: string
  apiKeyId?: string
  gatewayUrl?: string  // resolved by caller; falls back to tenantId-based container URL or env var
}


interface DeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
}

function loadDeviceIdentity(): DeviceIdentity {
  const raw = readFileSync('/home/suyashresearchwork/.openclaw/identity/device.json', 'utf8')
  const parsed = JSON.parse(raw) as DeviceIdentity
  return parsed
}

function base64UrlFromPem(publicKeyPem: string): string {
  // Extract raw 32-byte Ed25519 public key from SPKI PEM, then base64url-encode
  const key = publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '')
  // SPKI prefix for Ed25519 is 12 bytes (hex: 302a300506032b6570032100), raw key is last 32 bytes
  const der = Buffer.from(key, 'base64')
  const raw = der.slice(der.length - 32)
  return raw.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const sig = cryptoSign(null, Buffer.from(payload), { key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  return sig.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const DEVICE_IDENTITY = loadDeviceIdentity()
const DEVICE_PUBLIC_KEY_B64URL = base64UrlFromPem(DEVICE_IDENTITY.publicKeyPem)

export class OpenClawClient {
  private ws: WebSocket | null = null
  private connected = false
  private reqId = 0
  private accumulatedText = ''   // tracks accumulated delta text to compute diffs
  private doneCalled = false      // prevents double onDone when session.message + lifecycle:end both fire
  private activeSessionKey = ''
  private pendingModelPatch: string | null = null
  private pendingChatSendId: string | null = null
  private pendingToolArgs = new Map<string, Record<string, unknown>>()
  private pendingResponses = new Map<string, { resolve: (res: Record<string, unknown>) => void; reject: (err: Error) => void }>()
  private pendingSystemContext = ''
  private lastMcpSignature: string | null = null
  private readonly gatewayUrl: string
  private readonly gatewayToken: string

  constructor(private readonly opts: OpenClawClientOptions) {
    // Resolution priority:
    //   1. opts.gatewayUrl  — caller resolved (SSE path: fetched from agent-server)
    //   2. OPENCLAW_GATEWAY_URL env var — local dev override
    //   3. localhost:18790 fallback — local dev without container
    // NOTE: Docker DNS is NOT used. Relay is a host process; containers are reachable
    // only via published ports (localhost:{bridgePort}), not Docker network DNS.
    if (opts.gatewayUrl) {
      this.gatewayUrl = opts.gatewayUrl
    } else if (process.env.OPENCLAW_GATEWAY_URL) {
      this.gatewayUrl = process.env.OPENCLAW_GATEWAY_URL
    } else {
      this.gatewayUrl = 'ws://localhost:18790'
    }
    this.gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? ''
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const gatewayUrl = this.gatewayUrl
      const gatewayToken = this.gatewayToken

      const ws = new WebSocket(gatewayUrl)
      this.ws = ws

      const connectTimeout = setTimeout(() => {
        ws.terminate()
        reject(new Error('OpenClaw connect timed out'))
      }, 10_000)

      // Do NOT send connect on open — the gateway always sends connect.challenge first.
      // sendConnect() is called when the challenge is received.

      ws.on('message', (raw) => {
        console.log('[openclaw] raw response:', JSON.stringify(raw.toString()).slice(0, 800))
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>
        } catch {
          return
        }

        if (!this.connected) {
          // Waiting for connect.challenge then connect ack
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            const payload = msg.payload as Record<string, unknown> | undefined
            const nonce = typeof payload?.nonce === 'string' ? payload.nonce : ''
            this.sendConnectReq(gatewayToken, nonce)
            return
          }

          if (msg.type === 'res' && (msg.payload as Record<string, unknown>)?.type === 'hello-ok') {
            clearTimeout(connectTimeout)
            this.connected = true
            this.sendSessionsSubscribe()
            resolve()
            return
          }

          if (msg.type === 'error') {
            clearTimeout(connectTimeout)
            reject(new Error(`OpenClaw connect error: ${JSON.stringify(msg)}`))
          }
          return
        }

        // Resolve any pending async requests (config.get, config.patch, etc.)
        if (msg.type === 'res' && typeof msg.id === 'string' && this.pendingResponses.has(msg.id)) {
          const pending = this.pendingResponses.get(msg.id)!
          this.pendingResponses.delete(msg.id)
          if (msg.ok === false) {
            const errMsg = (msg.error as Record<string, unknown>)?.message ?? 'Request failed'
            pending.reject(new Error(String(errMsg)))
          } else {
            pending.resolve((msg.payload as Record<string, unknown>) ?? {})
          }
          return
        }

        // Handle sessions.changed event — fired after store write, carries accurate token counts
        if (msg.type === 'event' && msg.event === 'sessions.changed') {
          const p = msg.payload as Record<string, unknown> | undefined
          if (p?.phase === 'end' && p?.sessionKey === this.activeSessionKey) {
            const inputTokens = typeof p.inputTokens === 'number' ? p.inputTokens : undefined
            const outputTokens = typeof p.outputTokens === 'number' ? p.outputTokens : undefined
            const estimatedCostUsd = typeof p.estimatedCostUsd === 'number' ? p.estimatedCostUsd : undefined
            console.log('[usage] sessions.changed phase=end — recording tokens, input:', inputTokens, 'output:', outputTokens, 'costUsd:', estimatedCostUsd)
            if (this.opts.onTokens) this.opts.onTokens(inputTokens ?? 0, outputTokens ?? 0, estimatedCostUsd)
            recordUsage({
              tenantId: this.opts.tenantId!,
              actorId: this.opts.actorId!,
              apiKeyId: this.opts.apiKeyId,
              inputTokens: inputTokens && inputTokens > 0 ? inputTokens : undefined,
              outputTokens: outputTokens && outputTokens > 0 ? outputTokens : undefined,
            })
          }
          return
        }

        // Handle chat.send error response (e.g. attachment too large)
        if (msg.type === 'res' && msg.id === this.pendingChatSendId && msg.ok === false) {
          this.pendingChatSendId = null
          const errMsg = (msg.error as Record<string, unknown>)?.message ?? 'Message rejected by gateway'
          console.error('[openclaw] chat.send rejected:', errMsg)
          if (this.opts.onSendError) {
            this.opts.onSendError(new Error(String(errMsg)))
          } else {
            this.opts.onError(new Error(String(errMsg)))
          }
          return
        }
        if (msg.type === 'res' && msg.id === this.pendingChatSendId && msg.ok !== false) {
          this.pendingChatSendId = null
        }

        // Connected — handle agent events
        if (msg.type === 'event' && msg.event === 'agent') {
          const payload = msg.payload as Record<string, unknown> | undefined
          if (!payload) return
          const stream = payload.stream as string | undefined
          const data = payload.data as Record<string, unknown> | undefined
          if (!data) return

          if (stream === 'assistant') {
            console.log('[openclaw] assistant stream data:', JSON.stringify(data, null, 2))
            const delta = typeof data.delta === 'string' ? data.delta : ''
            if (delta) this.opts.onDelta(delta)
            // track accumulated for fallback
            if (typeof data.text === 'string') this.accumulatedText = data.text

          } else if (stream === 'tool_call' || stream === 'tool') {
            if (this.opts.onToolCall) {
              const tool = typeof data.name === 'string' ? data.name : typeof data.tool === 'string' ? data.tool : ''
              const args = (typeof data.arguments === 'object' && data.arguments !== null)
                ? data.arguments as Record<string, unknown>
                : typeof data.args === 'object' && data.args !== null
                ? data.args as Record<string, unknown>
                : {}
              const callId = typeof data.id === 'string' ? data.id
                : typeof data.callId === 'string' ? data.callId
                : undefined
              if (tool) this.opts.onToolCall(tool, args, callId)
            }
          } else if (stream === 'lifecycle' && (data as Record<string, unknown>).phase === 'end') {
            console.log('[openclaw] lifecycle:end data:', JSON.stringify(data, null, 2))
            const fullText = this.accumulatedText.trim()
            this.accumulatedText = ''
            if (!this.doneCalled && fullText) {
              this.opts.onDone(fullText)
            }
            this.doneCalled = false
            // session.message calls onDone for webchat path — lifecycle:end handles streaming delta path
            // Token recording is handled by sessions.changed phase=end event (fired after store write)
          }
        }

        // Handle session.tool events — fired when a tool call starts/completes (webchat path)
        // OpenClaw sends event:'session.tool' not event:'agent' stream:'tool', so the agent
        // block above never fires for tool calls in webchat sessions. Handle it here.
        if (msg.type === 'event' && msg.event === 'session.tool') {
          const p = msg.payload as Record<string, unknown> | undefined
          if (!p) return
          const data = p.data as Record<string, unknown> | undefined
          if (!data) return
          const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
          if (data.phase === 'start') {
            // Cache args keyed by toolCallId — result phase carries no args
            const args = (typeof data.args === 'object' && data.args !== null)
              ? data.args as Record<string, unknown>
              : {}
            if (callId) this.pendingToolArgs.set(callId, args)
            const startTool = typeof data.name === 'string' ? data.name : ''
            if (startTool && this.opts.onToolCallStart) {
              this.opts.onToolCallStart(startTool, args, callId)
            }
          } else if (data.phase === 'result' && this.opts.onToolCall) {
            const isError = data.isError === true
            const errorMessage = isError && typeof data.meta === 'string' ? data.meta : undefined
            const tool = typeof data.name === 'string' ? data.name : ''
            // Prefer cached args from start; fall back to whatever result carries
            const args = (callId && this.pendingToolArgs.has(callId))
              ? this.pendingToolArgs.get(callId)!
              : (typeof data.args === 'object' && data.args !== null)
              ? data.args as Record<string, unknown>
              : {}
            if (callId) this.pendingToolArgs.delete(callId)
            if (tool) this.opts.onToolCall(tool, args, callId, isError, errorMessage)
          }
        }

        // Handle session.message events — fired when agent completes a full message
        // This is the primary delivery path for webchat sessions
        if (msg.type === 'event' && msg.event === 'session.message') {
          const p = msg.payload as Record<string, unknown> | undefined
          if (!p) return
          const sessionKey = p.sessionKey as string | undefined
          if (!sessionKey || !sessionKey.endsWith(this.activeSessionKey)) return
          const message = p.message as Record<string, unknown> | undefined
          if (!message || message.role !== 'assistant') return
          // Tool call messages (stopReason='toolUse') are intermediate — agent is not done yet.
          // Only process messages where the agent has finished its turn (stopReason='stop' or similar).
          if (message.stopReason === 'toolUse') return
          const content = message.content
          let text = ''
          if (typeof content === 'string') {
            text = content
          } else if (Array.isArray(content)) {
            text = content
              .filter((c: unknown) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text')
              .map((c: unknown) => (c as Record<string, unknown>).text as string)
              .join('')
            // If no text content, check for a tts toolCall — extract its text so
            // voice-only responses reach the webchat frontend as readable text
            if (!text) {
              const ttsCall = (content as Record<string, unknown>[]).find(
                c => c.type === 'toolCall' && c.name === 'tts'
              )
              if (ttsCall) {
                const args = ttsCall.arguments as Record<string, unknown> | undefined
                text = typeof args?.text === 'string' ? args.text : ''
                if (text) console.log('[openclaw] session.message tts toolCall text, length:', text.length)
              }
            }
          }
          text = text.replace(/<final>([\s\S]*?)<\/final>/g, '$1').trim()
          text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
          if (text) {
            this.doneCalled = true  // prevent lifecycle:end from double-firing
            console.log('[openclaw] session.message assistant text, length:', text.length)
            this.accumulatedText = text
            this.opts.onDone(text)
            this.accumulatedText = ''
          } else {
            // Empty assistant message — likely a replayed/old message from session history.
            // Do NOT set doneCalled or fire onDone — keep waiting for the real response.
            console.log('[openclaw] session.message empty assistant response — ignoring, waiting for real response')
          }
        }
      })

      ws.on('close', () => {
        clearTimeout(connectTimeout)
        this.connected = false
        this.opts.onClose()
      })

      ws.on('error', (err) => {
        clearTimeout(connectTimeout)
        this.opts.onError(err)
        if (!this.connected) reject(err)
      })
    })
  }

  /** Injects text into the system prompt for the next sendMessage call only. */
  prependSystemContext(context: string): void {
    this.pendingSystemContext = context
  }

  sendMessage(message: string, images: { name: string, mimeType: string, content: string }[] = [], sessionKey: string): void {
    this.activeSessionKey = sessionKey
    if (this.pendingModelPatch) {
      this.patchSessionModel(this.pendingModelPatch)
      this.pendingModelPatch = null
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.accumulatedText = ''

    // Build final message: one-shot RAG context (if any) prepended to user message.
    let finalMessage = message
    if (this.pendingSystemContext) {
      finalMessage = `<system_context>\n${this.pendingSystemContext}\n</system_context>\n\n${finalMessage}`
      this.pendingSystemContext = ''
    }

    console.log('[openclaw] chat.send params:', JSON.stringify({
      sessionKey,
      message: finalMessage.slice(0, 50),
      attachments: images.map(img => ({
        name: img.name,
        mimeType: img.mimeType,
        contentPrefix: img.content?.slice(0, 30),
        contentLength: img.content?.length
      })),
      idempotencyKey: '...'
    }))
    const sendId = this.nextId()
    this.pendingChatSendId = sendId
    this.ws.send(JSON.stringify({
      type: 'req',
      id: sendId,
      method: 'chat.send',
      params: { sessionKey, message: finalMessage, attachments: images, idempotencyKey: randomUUID() },
    }))
    console.log('[openclaw] chat.send sent, images count:', images.length, 'message length:', finalMessage.length)
  }

  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close()
    }
  }

  private sendConnectReq(token: string, nonce: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const { deviceId, privateKeyPem } = DEVICE_IDENTITY
    const clientId = 'gateway-client'
    const clientMode = 'backend'
    const role = 'operator'
    const scopes = ['operator.read', 'operator.write', 'operator.admin']
    const platform = 'linux'
    const deviceFamily = ''
    const signedAtMs = Date.now()

    const payloadStr = [
      'v3',
      deviceId,
      clientId,
      clientMode,
      role,
      scopes.join(','),
      String(signedAtMs),
      token,
      nonce,
      platform,
      deviceFamily,
    ].join('|')

    const signature = signDevicePayload(privateKeyPem, payloadStr)

    this.ws.send(JSON.stringify({
      type: 'req',
      id: this.nextId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role,
        scopes,
        auth: { token },
        device: {
          id: deviceId,
          publicKey: DEVICE_PUBLIC_KEY_B64URL,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        client: {
          id: clientId,
          version: '1.0.0',
          platform,
          mode: clientMode,
        },
        caps: [],
        commands: [],
        permissions: {},
        locale: 'en-US',
        userAgent: 'agent-relay/1.0.0',
      },
    }))
  }

  /** Resolves a pending exec approval via the exec.approval.resolve RPC. */
  resolveApproval(approvalId: string, decision: 'allow-once' | 'allow-always' | 'deny'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      type: 'req',
      id: this.nextId(),
      method: 'exec.approval.resolve',
      params: { id: approvalId, decision },
    }))
    console.log(`[openclaw] exec.approval.resolve id=${approvalId} decision=${decision}`)
  }

  setActorId(actorId: string): void {
    this.opts.actorId = actorId
  }

  patchSessionModel(model: string): void {
    if (!this.activeSessionKey) {
      this.pendingModelPatch = model
      return
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      type: 'req',
      id: randomUUID(),
      method: 'sessions.patch',
      params: { key: this.activeSessionKey, model },
    }))
  }

  async patchSessionMcp(mcpServers: Array<{ url: string; headers?: Record<string, string> }>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    // Build the servers object first so we can compute a signature before doing any network calls.
    const servers: Record<string, unknown> = {}
    for (const s of mcpServers) {
      const name = new URL(s.url).hostname + ':' + new URL(s.url).port || 'mcp'
      servers[name] = { url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
    }
    const raw = JSON.stringify({ mcp: { servers } })

    // Skip config.patch entirely if the MCP config hasn't changed since the last call.
    // config.patch sends SIGUSR1 to the OpenClaw gateway, causing a full process restart
    // (~50s downtime). When the list is unchanged (changedPaths=<none>) the restart is
    // pointless and causes ECONNRESET / 502 for any concurrent task requests.
    const signature = raw
    if (this.lastMcpSignature === signature) {
      console.log('[openclaw] config.patch skipped — MCP config unchanged, count:', mcpServers.length)
      return
    }

    // config.patch requires a baseHash from config.get — fetch it first
    let baseHash: string | undefined
    try {
      const configRes = await this.sendRequestAsync('config.get', {})
      baseHash = typeof configRes.hash === 'string' ? configRes.hash
        : typeof configRes.baseHash === 'string' ? configRes.baseHash
        : undefined
      if (!baseHash) {
        console.warn('[openclaw] config.get returned no hash, keys:', Object.keys(configRes).join(', '))
      }
    } catch (err) {
      console.warn('[openclaw] config.get failed:', (err as Error).message)
    }

    const patchParams: Record<string, unknown> = { raw }
    if (baseHash) patchParams.baseHash = baseHash

    try {
      await this.sendRequestAsync('config.patch', patchParams)
      this.lastMcpSignature = signature
      console.log('[openclaw] config.patch mcp.servers applied, count:', mcpServers.length)
    } catch (err) {
      console.error('[openclaw] config.patch failed:', (err as Error).message)
    }
  }

  private sendRequestAsync(method: string, params: Record<string, unknown>, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not open'))
        return
      }
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id)
        reject(new Error(`${method} request timed out`))
      }, timeoutMs)
      this.pendingResponses.set(id, {
        resolve: (res) => { clearTimeout(timer); resolve(res) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      })
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  private sendSessionsSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      type: 'req',
      id: this.nextId(),
      method: 'sessions.subscribe',
      params: {},
    }))
    console.log('[usage] sessions.subscribe sent')
  }

  private nextId(): string {
    return String(++this.reqId)
  }
}
