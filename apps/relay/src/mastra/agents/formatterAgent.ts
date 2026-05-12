import { Agent } from '@mastra/core/agent'

import { saarthiModel } from '../model.js'

// ---------------------------------------------------------------------------
// No-tools formatter agent for Pass 2 of step execution.
// Zero tools means Gemini uses responseSchema (structured output) without
// conflict from functionDeclarations — the two are mutually exclusive in the
// Gemini API.
// ---------------------------------------------------------------------------

export const formatterAgent = new Agent({
  id: 'saarthi-formatter',
  name: 'Saarthi Formatter',
  instructions: 'You are a structured data formatter. Convert agent output to JSON exactly as specified.',
  tools: {},
  model: saarthiModel,
})
