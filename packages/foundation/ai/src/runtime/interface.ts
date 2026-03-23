// Abstract interface - implementations will extend this

import type { AgentRunRequest, AgentRunResponse } from './types';

export interface AgentRuntime {
  /**
   * Run agent with given messages and config
   * Returns the assistant's response
   */
  run(request: AgentRunRequest): Promise<AgentRunResponse>;

  /**
   * Stream agent response (for real-time chat)
   * Yields partial responses as they come
   */
  streamRun?(request: AgentRunRequest): AsyncIterable<Partial<AgentRunResponse>>;

  /**
   * Check if runtime is available/configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get runtime identifier
   */
  getName(): string;
}
