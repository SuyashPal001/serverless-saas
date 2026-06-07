// Advisor run-tools — each calls the corresponding deterministic step in-process.
// tenderId and tenantId are read from RequestContext (injected by the chat route).
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { pqEvaluateStep } from '../../workflows/tenderEvaluationWorkflow.pqEvaluate.js'
import { technicalEvaluateStep } from '../../workflows/tenderEvaluationWorkflow.technicalEvaluate.js'
import { shortfallDetectStep } from '../../workflows/tenderEvaluationWorkflow.shortfallDetect.js'
import { financialEvaluateStep } from '../../workflows/tenderEvaluationWorkflow.financialEvaluate.js'
import { reportAssembleStep } from '../../workflows/tenderEvaluationWorkflow.reportAssemble.js'
import {
  buildBidderMap, asPqBidders,
  buildPqResults, buildTechResults, buildShortfallItems, buildFinResults,
} from './advisorRunHelpers.js'

function getCtx(execContext: unknown): { tenderId: string; tenantId: string } {
  const rc = (execContext as any)?.requestContext
  return {
    tenderId: rc?.get('tenderId') as string ?? '',
    tenantId: rc?.get('tenantId') as string ?? '',
  }
}

const ctxError = (label: string) =>
  ({ error: `${label}: missing tenderId or tenantId in session context` } as const)

export const runPqTool = createTool({
  id: 'run_pq',
  description: 'Run the PQ (Pre-Qualification) evaluation stage. Extracts eligibility criteria from each bidder\'s documents, evaluates against RFP thresholds, and returns the qualified bidder set. Call this first before any other stage.',
  inputSchema: z.object({}),
  execute: async (_params, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return ctxError('run_pq')

    const result = await pqEvaluateStep.execute({ inputData: { tenderId, tenantId } })
    return {
      qualifiedBidderIds: result.qualifiedBidderIds,
      totalBidders: result.bidders.length,
      qualifiedCount: result.qualifiedBidderIds.length,
      pqResults: result.pqResults.map(r => ({
        bidderId: r.bidderId, bidderName: r.bidderName, displayLabel: r.displayLabel,
        overallStatus: r.overallStatus,
        failedRules: r.findings.filter(f => f.status !== 'qualified').map(f => f.ruleName),
      })),
    }
  },
})

export const runTechnicalTool = createTool({
  id: 'run_technical',
  description: 'Run Technical evaluation for qualified bidders. Evaluates each RFP clause against bid text. Requires qualifiedBidderIds from run_pq. Optional bidderId for single-bidder live run.',
  inputSchema: z.object({
    qualifiedBidderIds: z.array(z.string()).describe('Array of bidderId strings from run_pq result'),
    bidderId: z.string().optional().describe('Run for a single bidder only (optional)'),
  }),
  execute: async ({ qualifiedBidderIds, bidderId }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return ctxError('run_technical')

    const bMap = await buildBidderMap(tenderId)
    const pqBidders = asPqBidders(bMap)
    const pqResults = await buildPqResults(tenderId, tenantId, bMap)

    const result = await technicalEvaluateStep.execute({
      inputData: { tenderId, tenantId, bidders: pqBidders, pqResults, qualifiedBidderIds, liveRunBidderId: bidderId },
    })
    return {
      techResults: result.techResults.map(r => ({
        bidderId: r.bidderId, bidderName: r.bidderName, displayLabel: r.displayLabel,
        compliedCount: r.compliedCount, deviationCount: r.deviationCount, notFoundCount: r.notFoundCount,
      })),
    }
  },
})

export const runShortfallTool = createTool({
  id: 'run_shortfall',
  description: 'Detect shortfalls from technical and PQ findings, auto-draft CVC-compliant clarification requests. Requires qualifiedBidderIds from run_pq. Run after run_technical.',
  inputSchema: z.object({
    qualifiedBidderIds: z.array(z.string()).describe('Array of bidderId strings from run_pq result'),
  }),
  execute: async ({ qualifiedBidderIds }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return ctxError('run_shortfall')

    const bMap = await buildBidderMap(tenderId)
    const pqBidders = asPqBidders(bMap)
    const pqResults = await buildPqResults(tenderId, tenantId, bMap)
    const techResults = await buildTechResults(tenderId, tenantId, bMap)

    const result = await shortfallDetectStep.execute({
      inputData: { tenderId, tenantId, bidders: pqBidders, pqResults, qualifiedBidderIds, techResults },
    })
    return {
      shortfallCount: result.shortfalls.length,
      shortfalls: result.shortfalls.map(s => ({
        bidderId: s.bidderId, bidderName: s.bidderName,
        discrepancy: s.discrepancy, status: s.status,
      })),
    }
  },
})

export const runFinancialTool = createTool({
  id: 'run_financial',
  description: 'Run Financial evaluation — extract BOQ from financial bids, apply arithmetic correction, determine L1. Requires qualifiedBidderIds from run_pq. Run after run_shortfall.',
  inputSchema: z.object({
    qualifiedBidderIds: z.array(z.string()).describe('Array of bidderId strings from run_pq result'),
  }),
  execute: async ({ qualifiedBidderIds }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return ctxError('run_financial')

    const bMap = await buildBidderMap(tenderId)
    const pqBidders = asPqBidders(bMap)
    const pqResults = await buildPqResults(tenderId, tenantId, bMap)
    const techResults = await buildTechResults(tenderId, tenantId, bMap)
    const shortfallItems = await buildShortfallItems(tenderId, tenantId, bMap)

    const result = await financialEvaluateStep.execute({
      inputData: { tenderId, tenantId, bidders: pqBidders, pqResults, qualifiedBidderIds, techResults, shortfalls: shortfallItems },
    })
    return {
      l1BidderId: result.l1BidderId,
      l1Amount: result.l1Amount,
      rankings: result.finResults.map(r => ({
        bidderId: r.bidderId, bidderName: r.bidderName, displayLabel: r.displayLabel,
        correctedTotal: r.correctedTotal, isL1: r.isL1, l1Margin: r.l1Margin,
      })),
    }
  },
})

export const runReportTool = createTool({
  id: 'run_report',
  description: 'Assemble the final evaluation report. Requires l1BidderId and l1Amount from run_financial. Run only after run_financial.',
  inputSchema: z.object({
    l1BidderId: z.string().describe('L1 bidder UUID from run_financial result'),
    l1Amount: z.number().describe('L1 corrected total amount from run_financial result'),
  }),
  execute: async ({ l1BidderId, l1Amount }, execContext) => {
    const { tenderId, tenantId } = getCtx(execContext)
    if (!tenderId || !tenantId) return ctxError('run_report')

    const bMap = await buildBidderMap(tenderId)
    const pqBidders = asPqBidders(bMap)
    const pqResults = await buildPqResults(tenderId, tenantId, bMap)
    const techResults = await buildTechResults(tenderId, tenantId, bMap)
    const shortfallItems = await buildShortfallItems(tenderId, tenantId, bMap)
    const finResults = await buildFinResults(tenderId, tenantId, bMap)
    const qualifiedBidderIds = pqResults.filter(r => r.overallStatus === 'qualified').map(r => r.bidderId)

    const result = await reportAssembleStep.execute({
      inputData: {
        tenderId, tenantId, bidders: pqBidders, pqResults, qualifiedBidderIds,
        techResults, shortfalls: shortfallItems, finResults, l1BidderId, l1Amount,
      },
    })
    return { reportId: result.reportId, recommendation: result.recommendation }
  },
})
