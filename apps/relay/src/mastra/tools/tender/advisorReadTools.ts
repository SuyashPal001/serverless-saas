// Advisor read-tools — Q&A queries against persisted evaluation findings.
// tenderId and tenantId are read from RequestContext.
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, bidders, pqFindings, technicalFindings, shortfalls, financialFindings, evaluationReports } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { getFullBidText } from '../../../../tender/getFullBidText.js'
import * as crypto from 'crypto'

function getCtx(execContext: unknown): { tenderId: string; tenantId: string } {
  const rc = (execContext as any)?.requestContext
  return {
    tenderId: rc?.get('tenderId') as string ?? '',
    tenantId: rc?.get('tenantId') as string ?? '',
  }
}

function bidderFolderIdFor(tenantId: string, tenderId: string, displayLabel: string): string {
  const stem = displayLabel.toLowerCase().replace(/\s+/g, '-')
  const h = crypto.createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}

export const getPqFindingsTool = createTool({
  id: 'get_pq_findings',
  description: 'Retrieve PQ (Pre-Qualification) findings for this tender from the database. Use for questions about eligibility results, turnover thresholds, OEM authorisation, blacklisting.',
  inputSchema: z.object({
    bidderId: z.string().optional().describe('Filter to a specific bidder UUID'),
  }),
  execute: async ({ bidderId }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const filters = [eq(pqFindings.tenderId, tenderId), eq(pqFindings.tenantId, tenantId)]
    if (bidderId) filters.push(eq(pqFindings.bidderId, bidderId))
    const rows = await db.select().from(pqFindings).where(and(...filters))
    return { count: rows.length, findings: rows.map(r => ({
      findingId: r.id, bidderId: r.bidderId, ruleId: r.ruleId, ruleName: r.ruleName,
      status: r.status, narration: r.narration,
      declaredValue: r.declaredValue, thresholdValue: r.thresholdValue,
      sourceDoc: r.sourceDoc, sourcePage: r.sourcePage,
    }))}
  },
})

export const getTechnicalFindingsTool = createTool({
  id: 'get_technical_findings',
  description: 'Retrieve technical compliance findings for this tender. Use for questions about clause compliance, deviations, not-found items, bidder technical scores.',
  inputSchema: z.object({
    bidderId: z.string().optional().describe('Filter to a specific bidder UUID'),
    clauseNo: z.string().optional().describe('Filter to a specific clause number e.g. "3.8"'),
  }),
  execute: async ({ bidderId, clauseNo }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const filters = [eq(technicalFindings.tenderId, tenderId), eq(technicalFindings.tenantId, tenantId)]
    if (bidderId) filters.push(eq(technicalFindings.bidderId, bidderId))
    if (clauseNo) filters.push(eq(technicalFindings.clauseNo, clauseNo))
    const rows = await db.select().from(technicalFindings).where(and(...filters))
    return { count: rows.length, findings: rows.map(r => ({
      findingId: r.id, bidderId: r.bidderId, clauseNo: r.clauseNo, clauseTitle: r.clauseTitle,
      status: r.status, narration: r.narration,
      rfpRequirement: r.rfpRequirement, bidderResponse: r.bidderResponse,
      sourceDoc: r.sourceDoc, sourcePage: r.sourcePage,
    }))}
  },
})

export const getShortfallsTool = createTool({
  id: 'get_shortfalls',
  description: 'Retrieve shortfall discrepancies and clarification requests for this tender. Use for questions about what deviations were flagged and what clarifications were drafted.',
  inputSchema: z.object({
    bidderId: z.string().optional().describe('Filter to a specific bidder UUID'),
  }),
  execute: async ({ bidderId }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const filters = [eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId)]
    if (bidderId) filters.push(eq(shortfalls.bidderId, bidderId))
    const rows = await db.select().from(shortfalls).where(and(...filters))
    return { count: rows.length, shortfalls: rows.map(r => ({
      shortfallId: r.id, bidderId: r.bidderId, discrepancy: r.discrepancy,
      sourceDoc: r.sourceDoc, sourcePage: r.sourcePage, status: r.status,
    }))}
  },
})

export const getFinancialTool = createTool({
  id: 'get_financial',
  description: 'Retrieve financial evaluation findings — BOQ lines, corrected totals, L1 determination. Use for questions about bid amounts, arithmetic corrections, L1/L2 ranking.',
  inputSchema: z.object({
    bidderId: z.string().optional().describe('Filter to a specific bidder UUID'),
  }),
  execute: async ({ bidderId }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const filters = [eq(financialFindings.tenderId, tenderId), eq(financialFindings.tenantId, tenantId)]
    if (bidderId) filters.push(eq(financialFindings.bidderId, bidderId))
    const rows = await db.select().from(financialFindings).where(and(...filters))
    return { count: rows.length, findings: rows.map(r => ({
      findingId: r.id, bidderId: r.bidderId,
      totalAmount: parseFloat(String(r.totalAmount)),
      arithmeticCorrection: parseFloat(String(r.arithmeticCorrection ?? '0')),
      correctedTotal: parseFloat(String(r.correctedTotal)),
      isL1: r.isL1 === 'yes', l1Margin: r.l1Margin != null ? parseFloat(String(r.l1Margin)) : null,
      sourceDoc: r.sourceDoc, sourcePage: r.sourcePage,
    }))}
  },
})

export const getReportTool = createTool({
  id: 'get_report',
  description: 'Retrieve the consolidated evaluation report including PQ summary, technical summary, financial summary, and recommendation text.',
  inputSchema: z.object({}),
  execute: async (_params, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const rows = await db.select().from(evaluationReports).where(
      and(eq(evaluationReports.tenderId, tenderId), eq(evaluationReports.tenantId, tenantId))
    )
    if (!rows.length) return { error: 'No report found — run the full evaluation first.' }
    const r = rows[rows.length - 1]
    return {
      reportId: r.id, recommendation: r.recommendation,
      pqSummary: r.pqSummary, techSummary: r.techSummary, finSummary: r.finSummary,
      l1BidderId: r.l1BidderId, generatedAt: r.generatedAt,
    }
  },
})

export const getBidTextTool = createTool({
  id: 'get_bid_text',
  description: 'Retrieve the full indexed bid text for a specific bidder (for Q&A only — does not affect evaluation verdicts). Use when the officer asks to read a bid or verify a specific claim from documents.',
  inputSchema: z.object({
    bidderId: z.string().describe('The bidder UUID whose bid text to retrieve'),
  }),
  execute: async ({ bidderId }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return { error: 'Missing context' }
    const rows = await db.select({ name: bidders.name, displayLabel: bidders.displayLabel })
      .from(bidders).where(eq(bidders.id, bidderId))
    const bidder = rows[0]
    if (!bidder) return { error: `Bidder ${bidderId} not found` }
    const folderId = bidderFolderIdFor(tenantId, tenderId, bidder.displayLabel)
    const text = await getFullBidText(tenantId, folderId)
    return {
      bidderId, bidderName: bidder.name,
      textLength: text.length,
      text: text.slice(0, 50_000),
    }
  },
})
