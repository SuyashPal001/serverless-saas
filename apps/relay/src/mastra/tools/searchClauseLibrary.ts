import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, clauseLibrary } from '@serverless-saas/database'
import { and, eq, sql } from 'drizzle-orm'

const requestContextSchema = z.object({ tenantId: z.string() })

export const searchClauseLibraryTool = createTool({
  id: 'search_clause_library',
  description: `Search the organisation's standard clause library (GTC/SCC/BEC/eligibility/commercial clauses).
Use this for: "what does our EMD clause say", "find our standard Integrity Pact clause", "what's the MSE exemption wording", "look up clause CL-014", any question about standard/template clause text — NOT for questions about a specific tender's own authored sections (use retrieve_documents for that) or evaluation findings (use query_tender_findings for that).
Returns matching clauses with code, category, title, and content. Scoped to the caller's tenant.`,

  inputSchema: z.object({
    query: z.string().describe('Search text — a clause code, topic, or keyword'),
    category: z.enum(['Eligibility/PQ', 'Technical', 'SLA/KPI', 'Commercial', 'Security/Compliance', 'General Terms'])
      .optional().describe('Filter to a specific clause category (optional)'),
  }),

  requestContextSchema,

  outputSchema: z.object({
    found: z.boolean(),
    results: z.array(z.object({
      code: z.string(), category: z.string(), title: z.string(), content: z.string(),
    })),
  }),

  execute: async ({ query, category }, execContext) => {
    const tenantId = (execContext as any)?.requestContext?.get('tenantId') as string | undefined
      ?? (execContext as any)?.context?.tenantId as string | undefined
      ?? ''

    if (!tenantId) return { found: false, results: [] }

    const escaped = query.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)
    const pattern = `%${escaped}%`

    const filters = [
      eq(clauseLibrary.tenantId, tenantId),
      eq(clauseLibrary.isActive, true),
      sql`(${clauseLibrary.title} ILIKE ${pattern} OR ${clauseLibrary.content} ILIKE ${pattern} OR ${clauseLibrary.tags}::text ILIKE ${pattern})`,
    ]
    if (category) filters.push(eq(clauseLibrary.category, category))

    const rows = await db.select({
      code: clauseLibrary.code, category: clauseLibrary.category,
      title: clauseLibrary.title, content: clauseLibrary.content,
    }).from(clauseLibrary).where(and(...filters)).limit(10)

    return { found: rows.length > 0, results: rows }
  },
})
