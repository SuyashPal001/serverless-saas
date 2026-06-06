import { createStep } from '@mastra/core/workflows'
import { db, bidders, pqFindings } from '@serverless-saas/database'
import { eq } from 'drizzle-orm'
import { evaluatePqRules } from '../rules/tenderPqRules.js'
import { tenderInputSchema, pqStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

const INFERENCE_URL = process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001'
const NARRATION_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

async function narrate(message: string, provision: string): Promise<string> {
  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NARRATION_MODEL,
        messages: [
          { role: 'system', content: 'You are a government procurement evaluation officer. Rewrite this PQ finding in one clear, formal sentence. State the criterion, the declared value, and whether it qualifies. Do not change numbers.' },
          { role: 'user', content: `Finding: ${message}\nProvision: ${provision}` },
        ],
        stream: false,
      }),
    })
    if (!res.ok) return message
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || message
  } catch {
    return message
  }
}

export const pqEvaluateStep = createStep({
  id: 'tender-pq-evaluate',
  inputSchema: tenderInputSchema,
  outputSchema: pqStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId } = inputData

    // Load bidders for this tender
    const bidderRows = await db.select().from(bidders)
      .where(eq(bidders.tenderId, tenderId))

    const pqBidders = bidderRows.map(b => ({
      bidderId: b.id,
      bidderName: b.name,
      displayLabel: b.displayLabel,
      // pqFields are stored in the documents/metadata — for demo, read from bidder record
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pqFields: (b.documentIds as any)?.pqFields ?? {},
      documentIds: (b.documentIds as string[]) ?? [],
    }))

    const pqResults = []
    const qualifiedBidderIds: string[] = []

    for (const bidder of pqBidders) {
      const ruleResults = evaluatePqRules(bidder.pqFields)
      const overallStatus = ruleResults.some(r => r.status === 'not_qualified')
        ? 'not_qualified' : ruleResults.some(r => r.status === 'cannot_evaluate')
          ? 'cannot_evaluate' : 'qualified'

      const findings = await Promise.all(ruleResults.map(async (r) => {
        const narration = await narrate(r.message, r.provision)
        // Persist to DB
        const [row] = await db.insert(pqFindings).values({
          tenantId, tenderId, bidderId: bidder.bidderId,
          ruleId: r.ruleId, ruleName: r.ruleName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: r.status as any,
          provision: r.provision, narration,
          declaredValue: r.declaredValue ?? null,
          thresholdValue: r.thresholdValue ?? null,
          sourceDoc: r.ruleId === 'PQ001' ? 'Audited Balance Sheet' : null,
          sourcePage: r.ruleId === 'PQ001' ? 3 : null,
        }).returning({ id: pqFindings.id })
        return {
          ruleId: r.ruleId, ruleName: r.ruleName,
          status: r.status as 'qualified' | 'not_qualified' | 'cannot_evaluate',
          provision: r.provision, narration,
          declaredValue: r.declaredValue ?? null,
          thresholdValue: r.thresholdValue ?? null,
          sourceDoc: r.ruleId === 'PQ001' ? 'Audited Balance Sheet' : null,
          sourcePage: r.ruleId === 'PQ001' ? 3 : null,
          findingId: row.id,
        }
      }))

      if (overallStatus === 'qualified') qualifiedBidderIds.push(bidder.bidderId)

      // Update bidder status
      await db.update(bidders)
        .set({ status: overallStatus === 'qualified' ? 'pq_qualified' : 'pq_disqualified' })
        .where(eq(bidders.id, bidder.bidderId))

      pqResults.push({
        bidderId: bidder.bidderId, bidderName: bidder.bidderName,
        displayLabel: bidder.displayLabel,
        overallStatus: overallStatus as 'qualified' | 'not_qualified' | 'cannot_evaluate',
        findings,
      })
    }

    return { ...inputData, bidders: pqBidders, pqResults, qualifiedBidderIds }
  },
})
