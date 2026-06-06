import { createStep } from '@mastra/core/workflows'
import { db, evaluationReports } from '@serverless-saas/database'
import { finStepOutputSchema, reportStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

export const reportAssembleStep = createStep({
  id: 'tender-report-assemble',
  inputSchema: finStepOutputSchema,
  outputSchema: reportStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, pqResults, techResults, finResults, l1BidderId } = inputData

    const pqSummary = {
      total: pqResults.length,
      qualified: pqResults.filter(r => r.overallStatus === 'qualified').length,
      disqualified: pqResults.filter(r => r.overallStatus === 'not_qualified').length,
      bidders: pqResults.map(r => ({ name: r.bidderName, label: r.displayLabel, status: r.overallStatus })),
    }

    const techSummary = {
      evaluated: techResults.length,
      bidders: techResults.map(r => ({
        name: r.bidderName, label: r.displayLabel,
        complied: r.compliedCount, deviations: r.deviationCount, notFound: r.notFoundCount,
      })),
    }

    const l1Bidder = finResults.find(r => r.isL1)
    const finSummary = {
      evaluated: finResults.length,
      l1BidderName: l1Bidder?.bidderName ?? '',
      l1Amount: l1Bidder?.correctedTotal ?? 0,
      bidders: finResults.map(r => ({
        name: r.bidderName, label: r.displayLabel,
        correctedTotal: r.correctedTotal, isL1: r.isL1,
        l1Margin: r.l1Margin,
      })),
    }

    const recommendation = l1Bidder
      ? `Based on PQ scrutiny, technical evaluation, and financial bid comparison, ${l1Bidder.bidderName} (${l1Bidder.displayLabel}) is determined as L1 with a corrected total bid value of ₹${(l1Bidder.correctedTotal / 1e7).toFixed(2)} crore. Recommend award of contract subject to officer approval and compliance with GFR 2017 provisions.`
      : 'Evaluation inconclusive. Manual review required.'

    const [row] = await db.insert(evaluationReports).values({
      tenantId, tenderId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pqSummary: pqSummary as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      techSummary: techSummary as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finSummary: finSummary as any,
      recommendation,
      l1BidderId: l1BidderId || null,
    }).returning({ id: evaluationReports.id })

    return { ...inputData, reportId: row.id, recommendation }
  },
})
