// Isolated model definition — imported by both index.ts and taskExecution.ts.
// Keeping it here breaks the circular TDZ issue: saarthiModel must be available
// at module init time in taskExecution.ts (for scorer creation), but the
// index.ts → taskExecution.ts → index.ts circular dep causes a TDZ error when
// the model is defined in index.ts.

import { createGoogleGenerativeAI } from '@ai-sdk/google'

export const saarthiModel = createGoogleGenerativeAI({
  baseURL: (process.env.VERTEX_PROXY_URL ?? 'http://localhost:4001') + '/v1',
  apiKey: process.env.GEMINI_API_KEY ?? 'placeholder',
})(process.env.MASTRA_MODEL ?? 'gemini-2.5-flash')
