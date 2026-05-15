import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

interface RawChunk {
  content: string
  document_name: string
  score: number
}

export const fetchAgentContext = createTool({
  id: 'fetch-agent-context',
  description: 'Fetches product/company context for a tenant from the knowledge base using semantic search.',
  inputSchema: z.object({
    agentId: z.string(),
    tenantId: z.string(),
    query: z.string(),
  }),
  outputSchema: z.object({
    context: z.string(),
    sourceCount: z.number(),
  }),
  execute: async ({ context: { agentId: _agentId, tenantId, query } }) => {
    const apiBaseUrl = process.env.API_BASE_URL ?? ''
    const serviceKey = process.env.INTERNAL_SERVICE_KEY ?? ''

    let chunks: RawChunk[] = []

    try {
      const resp = await fetch(`${apiBaseUrl}/api/v1/internal/retrieve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': serviceKey,
        },
        body: JSON.stringify({ query, tenantId, limit: 5, scoreThreshold: 0.3 }),
      })

      if (resp.ok) {
        const data = await resp.json() as { chunks?: unknown[] }
        chunks = Array.isArray(data.chunks) ? (data.chunks as RawChunk[]) : []
      } else {
        console.error(`[fetchAgentContext] retrieve returned ${resp.status}`)
      }
    } catch (err) {
      console.error('[fetchAgentContext] fetch error:', err)
    }

    if (chunks.length === 0) {
      return { context: '', sourceCount: 0 }
    }

    const context = chunks.map(c => c.content).join('\n\n')
    return { context, sourceCount: chunks.length }
  },
})
