import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, pqFindings, technicalFindings, bidders } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'

const requestContextSchema = z.object({ tenantId: z.string() })

export const queryTenderFindingsTool = createTool({
  id: 'query_tender_findings',
  description: `Query evaluated findings for a tender from the database.
Use this for: "why did bidder X fail PQ", "which bidders passed stage 3", "compare technical compliance across bidders", "what deviations were found for clause Y".
Returns structured data — not prose. Scoped to the caller's tenant.`,

  inputSchema: z.object({
    tenderId:    z.string().describe('The tender UUID to query findings for'),
    queryType:   z.enum(['pq_summary', 'pq_detail', 'technical_summary', 'technical_detail', 'bidder_status'])
                  .describe('Type of query'),
    bidderId:    z.string().optional().describe('Filter to a specific bidder UUID (optional)'),
    clauseNo:    z.string().optional().describe('Filter technical findings to a clause number (optional)'),
  }),

  requestContextSchema,

  outputSchema: z.object({
    queryType: z.string(),
    tenderId:  z.string(),
    results:   z.unknown(),
  }),

  execute: async ({ tenderId, queryType, bidderId, clauseNo }, execContext) => {
    const tenantId = (execContext as any)?.requestContext?.get('tenantId') as string | undefined
      ?? (execContext as any)?.context?.tenantId as string | undefined
      ?? ''

    if (!tenantId) return { queryType, tenderId, results: { error: 'Missing tenant context' } }

    if (queryType === 'pq_summary' || queryType === 'pq_detail') {
      const filters = [eq(pqFindings.tenantId, tenantId), eq(pqFindings.tenderId, tenderId)]
      if (bidderId) filters.push(eq(pqFindings.bidderId, bidderId))

      const rows = await db.select().from(pqFindings).where(and(...filters))
      if (queryType === 'pq_summary') {
        const grouped: Record<string, { qualified: number; not_qualified: number; cannot_evaluate: number }> = {}
        for (const r of rows) {
          if (!grouped[r.bidderId]) grouped[r.bidderId] = { qualified: 0, not_qualified: 0, cannot_evaluate: 0 }
          grouped[r.bidderId][r.status as keyof typeof grouped[string]]++
        }
        return { queryType, tenderId, results: grouped }
      }
      return { queryType, tenderId, results: rows.map(r => ({
        bidderId: r.bidderId, ruleId: r.ruleId, ruleName: r.ruleName,
        status: r.status, narration: r.narration,
        declaredValue: r.declaredValue, thresholdValue: r.thresholdValue,
        sourceDoc: r.sourceDoc, sourcePage: r.sourcePage,
      }))}
    }

    if (queryType === 'technical_summary' || queryType === 'technical_detail') {
      const filters = [eq(technicalFindings.tenantId, tenantId), eq(technicalFindings.tenderId, tenderId)]
      if (bidderId) filters.push(eq(technicalFindings.bidderId, bidderId))
      if (clauseNo) filters.push(eq(technicalFindings.clauseNo, clauseNo))

      const rows = await db.select().from(technicalFindings).where(and(...filters))
      if (queryType === 'technical_summary') {
        const grouped: Record<string, { complied: number; deviation: number; not_found: number; cannot_evaluate: number }> = {}
        for (const r of rows) {
          if (!grouped[r.bidderId]) grouped[r.bidderId] = { complied: 0, deviation: 0, not_found: 0, cannot_evaluate: 0 }
          grouped[r.bidderId][r.status as keyof typeof grouped[string]]++
        }
        return { queryType, tenderId, results: grouped }
      }
      return { queryType, tenderId, results: rows.map(r => ({
        bidderId: r.bidderId, clauseNo: r.clauseNo, clauseTitle: r.clauseTitle,
        status: r.status, narration: r.narration,
        rfpRequirement: r.rfpRequirement, bidderResponse: r.bidderResponse,
        sourceDoc: r.sourceDoc, sourcePage: r.sourcePage,
      }))}
    }

    if (queryType === 'bidder_status') {
      const rows = await db.select({
        id: bidders.id, name: bidders.name, displayLabel: bidders.displayLabel, status: bidders.status,
      }).from(bidders).where(and(eq(bidders.tenantId, tenantId), eq(bidders.tenderId, tenderId)))
      return { queryType, tenderId, results: rows }
    }

    return { queryType, tenderId, results: { error: `Unknown queryType: ${queryType}` } }
  },
})
