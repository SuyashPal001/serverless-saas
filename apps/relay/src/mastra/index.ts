// Mastra proper orchestrator — ADR: Mastra Proper Orchestrator Adoption
//
// One Mastra instance registered at startup.
// One platform-level Agent (saarthi) serving all tenants.
// Per-tenant isolation via RequestContext + MASTRA_RESOURCE_ID_KEY.
//
// Backward-compat re-exports let app.ts and workflow.ts import unchanged.

import { Mastra } from '@mastra/core/mastra'
import { MastraEditor } from '@mastra/editor'
import { Observability, DefaultExporter } from '@mastra/observability'

import { getMastraStore, getMastraMemory } from './memory.js'
import { taskExecutionWorkflow } from './workflows/taskExecution.js'
import { documentWorkflow } from './workflows/documentWorkflow.js'
import { dodPassScorer } from './workflows/scorers.js'

import { platformAgent, SERVER_TOOLS } from './agents/platformAgent.js'
import { formatterAgent } from './agents/formatterAgent.js'
import { prdAgent } from './agents/prdAgent.js'

// ---------------------------------------------------------------------------
// Mastra instance — registered at startup with storage and platformAgent.
// Enables Mastra Studio, OTel spans, evals, and prompt versioning.
// ---------------------------------------------------------------------------

export const mastra = new Mastra({
  agents: { saarthi: platformAgent, formatter: formatterAgent, prd: prdAgent },
  workflows: { taskExecution: taskExecutionWorkflow, documentWorkflow },
  storage: getMastraStore(),
  scorers: { dodPass: dodPassScorer },
  editor: new MastraEditor(),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'saarthi-relay',
        exporters: [new DefaultExporter()],
      },
    },
  }),
})

// ---------------------------------------------------------------------------
// Re-exports — all consumers import from this file unchanged.
// ---------------------------------------------------------------------------

export { saarthiModel } from './model.js'
export { platformAgent, SERVER_TOOLS }
export { formatterAgent }
export { prdAgent }
export { getMastraStore, getMastraMemory } from './memory.js'
export { getMCPClientForTenant, getToolsForTenant } from './tools.js'
export { createTenantAgent } from './agent.js'
export type { TenantAgentWithClient } from './agent.js'
export { runMastraWorkflow } from './workflow.js'
export type { WorkflowContext } from './workflow.js'
export { taskExecutionWorkflow } from './workflows/taskExecution.js'
