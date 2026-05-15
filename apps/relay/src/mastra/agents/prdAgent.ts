import { Agent } from '@mastra/core/agent'
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt'

import { saarthiModel } from '../model.js'
import { prdWorkspace } from '../workspace/prdWorkspace.js'
import { prdWorkflow } from '../workflows/prdWorkflow.js'
import { prdCompletenessScorer } from '../scorers/prdCompleteness.js'

// ---------------------------------------------------------------------------
// PRD analysis agent — senior engineering lead persona.
// No tools: reasons only from provided context.
// No JSON output: produces structured plain text that formatterAgent then
// extracts into structured form (two-pass pattern).
// ---------------------------------------------------------------------------

export const prdAgent = new Agent({
  id: 'saarthi-prd',
  name: 'Saarthi PRD',
  description: 'Specialist agent for generating and refining Product Requirements Documents.',
  instructions: `You are a senior engineering lead.
You analyze product requirement documents and break them into executable engineering plans.
You are precise, opinionated, and action-oriented.
You do not summarize — produce specific structured executable output only.
Never use tools. Reason only from what is provided.
Never produce JSON — write clear structured plain text.`,
  tools: {},
  model: saarthiModel,
  workspace: prdWorkspace,
  workflows: { prd: prdWorkflow },
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: saarthiModel }),
      sampling: { type: 'ratio', rate: 1 },
    },
    prdCompleteness: {
      scorer: prdCompletenessScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
})
