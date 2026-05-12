import { Agent } from '@mastra/core/agent'

import { saarthiModel } from '../model.js'

// ---------------------------------------------------------------------------
// PRD analysis agent — senior engineering lead persona.
// No tools: reasons only from provided context.
// No JSON output: produces structured plain text that formatterAgent then
// extracts into structured form (two-pass pattern).
// ---------------------------------------------------------------------------

export const prdAgent = new Agent({
  id: 'saarthi-prd',
  name: 'Saarthi PRD',
  instructions: `You are a senior engineering lead.
You analyze product requirement documents and break them into executable engineering plans.
You are precise, opinionated, and action-oriented.
You do not summarize — produce specific structured executable output only.
Never use tools. Reason only from what is provided.
Never produce JSON — write clear structured plain text.`,
  tools: {},
  model: saarthiModel,
})
