import { Agent } from '@mastra/core/agent'
import { saarthiModel } from '../model.js'
import { getMastraMemory } from '../memory.js'
import { prdAgent } from './prdAgent.js'
import { prdWorkflow } from '../workflows/prdWorkflow.js'
import { fetchAgentContext } from '../tools/fetchAgentContext.js'
import { savePRD } from '../tools/savePRD.js'

export const pmAgent = new Agent({
  id: 'saarthi-pm',
  name: 'Saarthi PM',
  description: 'Supervisor agent that orchestrates PRD generation, roadmap planning, and task breakdown by delegating to specialist agents.',
  instructions: `You are a product management supervisor. Your job is to understand what the user needs and delegate to the right specialist agent.

Available specialists:
- prdAgent: use when the user wants to create, refine, or work on a PRD

Rules:
- NEVER generate PRD content yourself — always delegate to prdAgent
- Ask clarifying questions before delegating if the request is vague
- Use fetchAgentContext to load relevant product/company context before delegating
- After prdAgent completes, use savePRD to persist the draft, then summarize what was produced
- Ask the user if they want to refine the PRD or submit it for approval

Unavailable specialists (do not attempt):
- roadmapAgent — not yet built
- taskAgent — not yet built`,
  model: saarthiModel,
  memory: getMastraMemory(),
  agents: { prdAgent },
  workflows: { prdWorkflow },
  tools: { fetchAgentContext, savePRD },
})
