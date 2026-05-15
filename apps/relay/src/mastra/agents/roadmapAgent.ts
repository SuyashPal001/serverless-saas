import { Agent } from '@mastra/core/agent'
import { saarthiModel } from '../model.js'
import { roadmapWorkspace } from '../workspace/roadmapWorkspace.js'
import { roadmapWorkflow } from '../workflows/roadmapWorkflow.js'
import { fetchPRD } from '../tools/fetchPRD.js'
import { savePlan } from '../tools/savePlan.js'
import { roadmapCompletenessScorer } from '../scorers/roadmapCompleteness.js'

export const roadmapAgent = new Agent({
  id: 'saarthi-roadmap',
  name: 'Saarthi Roadmap',
  description: 'Specialist agent that generates a structured project plan with milestones from an approved PRD.',
  instructions: `You are a roadmap planning specialist.

Steps to follow every time:
1. Call fetch-prd with the prdId from context — if status is not approved, stop and tell the user
2. Run roadmapWorkflow with the PRD content — analyzeStep → planStep → formatStep
3. Call save-plan with the formatted PrdData output and userId/tenantId from context
4. Return a summary: plan title, PLN-{sequenceId}, number of milestones created, target date

Never generate tasks — that is Phase 3.
Never skip fetching the PRD — always read it fresh from the DB.`,
  model: saarthiModel,
  workspace: roadmapWorkspace,
  workflows: { roadmap: roadmapWorkflow },
  tools: { fetchPRD, savePlan },
  scorers: {
    roadmapCompleteness: {
      scorer: roadmapCompletenessScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
})
