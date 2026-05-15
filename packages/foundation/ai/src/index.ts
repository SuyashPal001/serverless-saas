// Main AI package export
export * from './runtime';
export * from './skills';
export * from './adapters';

// Config bundler
export { bundleAgentConfig } from './config/bundler';
export type { BundleConfigParams, BundleConfigResult } from './config/bundler';

// Runtime factory
export { getRuntime, selectRuntime } from './runtime/factory';
export type { RuntimeType } from './runtime/factory';

// Event handling
export { createEventHandler } from './events/handler';
export type { EventHandlerContext, EventHandlerResult } from './events/handler';

// Usage recording
export { recordAgentUsage, recordMetric, recordSessionStart } from './usage/recorder';
export type { UsageContext, UsageMetric } from './usage/recorder';
export { queueAgentUsage, queueMetric } from './usage/recorder-queued';

// Session management
export {
    getSession,
    getSessionData,
    createSession,
    touchSession,
    endSession,
    clearSession,
    getTenantSessions,
    getTenantSessionCount,
    cleanupTenantSessions,
} from './sessions/manager';
export type { SessionData, SessionSummary } from './sessions/manager';

// Tool registry
export * from './tools/index';

// RAG
export * from './embeddings';
export * from './cache';
export * from './retrieve';
export * from './format';
export * from './llm';

// GCP credentials helper (used by worker for Vertex AI calls)
export { getGcpCredentials } from './gcp-credentials';
