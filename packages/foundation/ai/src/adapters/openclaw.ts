/**
 * OpenClaw VM Adapter
 *
 * Connects to the OpenClaw VM via WebSocket for agent session execution.
 * Implements AgentSessionRuntime — the VM handles LLM calls, tool execution,
 * browser automation, and MCP connections. This adapter is the connection layer.
 *
 * STATUS: STUB — waiting for OpenClaw VM API contract.
 *
 * Questions to answer before implementing:
 * 1. WebSocket endpoint URL pattern (e.g. wss://vm.example.com/sessions)
 * 2. VM authentication mechanism (bearer token, HMAC, mTLS?)
 * 3. Exact JSON envelope for session.start and message.send
 * 4. Event schema the VM streams back (matches AgentEvent or mapping needed?)
 * 5. Usage reporting: push (usage.report event) or pull (GET /sessions/:id/usage)?
 */

import type {
  AgentSessionRuntime,
  AgentEventHandler,
  RuntimeConfig,
} from '../runtime/interface';
import type {
  AgentSessionConfig,
  SendMessageResult,
  SessionResult,
  UsageReport,
} from '../runtime/types';

export class OpenClawAdapter implements AgentSessionRuntime {
  readonly name = 'openclaw';

  private readonly wsEndpoint: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _authToken: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _timeoutMs: number;
  private readonly debug: boolean;

  /** Active WebSocket connections keyed by sessionId — populated once implemented */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _sessions: Map<string, WebSocket> = new Map();

  constructor(config: RuntimeConfig) {
    if (!config.wsEndpoint) {
      throw new Error('[OpenClawAdapter] wsEndpoint is required');
    }
    this.wsEndpoint = config.wsEndpoint;
    this._authToken = config.authToken ?? '';
    this._timeoutMs = config.timeoutMs ?? 30_000;
    this.debug = config.debug ?? false;
  }

  /**
   * Start a new agent session.
   *
   * TODO: Implement once OpenClaw VM API contract is defined.
   *
   * Expected flow:
   * 1. Open WebSocket to `${wsEndpoint}/sessions`
   * 2. On open, send { type: 'session.start', config } envelope
   * 3. Receive session.started event → resolve with sessionId
   * 4. Keep WebSocket open and pipe all events to onEvent callback
   * 5. Store connection in this.sessions for sendMessage calls
   */
  async startSession(
    config: AgentSessionConfig,
    _onEvent: AgentEventHandler,
  ): Promise<SessionResult> {
    this.log('startSession called', { sessionId: config.sessionId });

    // TODO: Open WebSocket
    // TODO: Send session config envelope
    // TODO: Await session.started event (with timeout)
    // TODO: Store ws in this.sessions

    /*
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsEndpoint}/sessions`, {
        headers: { Authorization: `Bearer ${this.authToken}` },
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('session.start timed out'));
      }, this.timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'session.start', config }));
      };

      ws.onmessage = (raw) => {
        const event = JSON.parse(raw.data as string) as AgentEvent;
        if (event.type === 'session.started') {
          clearTimeout(timeout);
          this.sessions.set(config.sessionId, ws);
          resolve({ sessionId: config.sessionId, status: 'active' });
        }
        onEvent(event);
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });
    */

    throw new Error('[OpenClawAdapter] startSession not implemented — waiting for VM API contract');
  }

  /**
   * Send a user message within an existing session.
   *
   * TODO: Implement once OpenClaw VM API contract is defined.
   *
   * Expected flow:
   * 1. Retrieve WebSocket from this.sessions
   * 2. Send { type: 'message.send', sessionId, content: message }
   * 3. VM streams agent.message.delta events until agent.message
   * 4. Return SendMessageResult immediately (events arrive via onEvent)
   */
  async sendMessage(
    sessionId: string,
    message: string,
    _onEvent: AgentEventHandler,
  ): Promise<SendMessageResult> {
    this.log('sendMessage called', { sessionId, messageLength: message.length });

    // TODO: Look up session WebSocket
    // TODO: Register onEvent for this message's events
    // TODO: Send message envelope
    // TODO: Return streaming status immediately

    /*
    const ws = this.sessions.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[OpenClawAdapter] No active session: ${sessionId}`);
    }

    const messageId = crypto.randomUUID();
    ws.send(JSON.stringify({ type: 'message.send', sessionId, messageId, content: message }));

    return { messageId, sessionId, status: 'streaming' };
    */

    throw new Error('[OpenClawAdapter] sendMessage not implemented — waiting for VM API contract');
  }

  /**
   * End a session gracefully.
   *
   * TODO: Implement once OpenClaw VM API contract is defined.
   *
   * Expected flow:
   * 1. Send { type: 'session.end', sessionId, reason }
   * 2. Await usage.report event (with timeout)
   * 3. Close WebSocket
   * 4. Remove from this.sessions
   */
  async endSession(
    sessionId: string,
    reason: 'completed' | 'user_cancelled' | 'timeout',
  ): Promise<UsageReport | null> {
    this.log('endSession called', { sessionId, reason });

    // TODO: Send session.end envelope
    // TODO: Collect final usage.report event
    // TODO: Close and clean up WebSocket

    /*
    const ws = this.sessions.get(sessionId);
    if (!ws) return null;

    ws.send(JSON.stringify({ type: 'session.end', sessionId, reason }));
    this.sessions.delete(sessionId);
    ws.close();

    return null; // replace with awaited usage report
    */

    throw new Error('[OpenClawAdapter] endSession not implemented — waiting for VM API contract');
  }

  /**
   * Submit a human approval decision for a pending action.
   *
   * TODO: Implement once OpenClaw VM API contract is defined.
   *
   * Expected flow:
   * 1. Send { type: 'approval.submit', sessionId, approvalId, approved, feedback }
   * 2. VM resumes execution
   */
  async submitApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean,
    _feedback?: string,
  ): Promise<void> {
    this.log('submitApproval called', { sessionId, approvalId, approved });

    // TODO: Look up session WebSocket
    // TODO: Send approval.submit envelope

    /*
    const ws = this.sessions.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[OpenClawAdapter] No active session: ${sessionId}`);
    }

    ws.send(JSON.stringify({ type: 'approval.submit', sessionId, approvalId, approved, feedback }));
    */

    throw new Error('[OpenClawAdapter] submitApproval not implemented — waiting for VM API contract');
  }

  /**
   * Ping the VM health endpoint.
   *
   * TODO: Replace with actual VM health check URL once known.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.wsEndpoint) return false;

    // TODO: GET ${httpEndpoint}/health or attempt a WebSocket ping.
    // Implementation will use this._authToken for the Authorization header
    // and this._timeoutMs as the request timeout.
    this.log('healthCheck: not yet implemented', {
      sessions: this._sessions.size,
      hasAuth: !!this._authToken,
      timeoutMs: this._timeoutMs,
    });

    return false;
  }

  // ---------------------------------------------------------------------------

  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[OpenClawAdapter] ${message}`, data ?? '');
    }
  }
}

/**
 * Factory for creating an OpenClaw adapter instance.
 */
export function createOpenClawAdapter(config: RuntimeConfig): AgentSessionRuntime {
  return new OpenClawAdapter(config);
}
