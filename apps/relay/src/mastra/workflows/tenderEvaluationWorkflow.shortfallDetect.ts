import { createStep } from '@mastra/core/workflows'
import { db, shortfalls, clarificationRequests } from '@serverless-saas/database'
import { techStepOutputSchema, shortfallStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

const INFERENCE_URL = process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001'
const NARRATION_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

async function draftClarification(discrepancy: string, clauseNo: string, clauseTitle: string): Promise<string> {
  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NARRATION_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a government procurement officer drafting a clarification request.
Rules (CVC guidelines):
- Must be time-bound (specify deadline in working days)
- Must NOT ask the bidder to change their quoted price or technical specs
- Must NOT seek new information not present in the RFP
- Must be factual and non-leading
- Keep it under 80 words
Return ONLY the clarification letter body, no headers.`,
          },
          {
            role: 'user',
            content: `Clause: ${clauseNo} — ${clauseTitle}\nShortfall: ${discrepancy}\nDraft the clarification request.`,
          },
        ],
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || buildFallbackClarification(discrepancy, clauseNo)
  } catch {
    return buildFallbackClarification(discrepancy, clauseNo)
  }
}

function buildFallbackClarification(discrepancy: string, clauseNo: string): string {
  return `With reference to your technical bid submitted against this RFP, it is observed that Clause ${clauseNo} requires clarification regarding: ${discrepancy}. You are requested to provide the requisite clarification/confirmation within 7 working days of receipt of this communication. Please note that no change in quoted price or technical specifications shall be permitted.`
}

export const shortfallDetectStep = createStep({
  id: 'tender-shortfall-detect',
  inputSchema: techStepOutputSchema,
  outputSchema: shortfallStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, techResults } = inputData
    const shortfallItems = []

    for (const bidder of techResults) {
      // Detect shortfalls: deviations + not_found clauses
      const flaggedClauses = bidder.clauses.filter(
        c => c.status === 'deviation' || c.status === 'not_found'
      )

      for (const clause of flaggedClauses) {
        // Only create clarification for deviations (not_found is disqualifying)
        if (clause.status !== 'deviation') {
          const [sf] = await db.insert(shortfalls).values({
            tenantId, tenderId, bidderId: bidder.bidderId,
            techFindingId: (clause as { findingId?: string }).findingId ?? null,
            discrepancy: `Clause ${clause.clauseNo} (${clause.clauseTitle}): Requirement not addressed in bid.`,
            sourceDoc: clause.sourceDoc ?? null,
            sourcePage: clause.sourcePage ?? null,
            status: 'open',
          }).returning({ id: shortfalls.id })

          shortfallItems.push({
            shortfallId: sf.id, bidderId: bidder.bidderId, bidderName: bidder.bidderName,
            discrepancy: `Clause ${clause.clauseNo}: Not addressed.`,
            sourceDoc: clause.sourceDoc ?? null, sourcePage: clause.sourcePage ?? null,
            draftedText: '', status: 'open',
          })
          continue
        }

        // Deviation — draft a CVC-clean clarification
        const discrepancy = clause.narration
        const draftedText = await draftClarification(discrepancy, clause.clauseNo, clause.clauseTitle)

        const [sf] = await db.insert(shortfalls).values({
          tenantId, tenderId, bidderId: bidder.bidderId,
          techFindingId: (clause as { findingId?: string }).findingId ?? null,
          discrepancy, sourceDoc: clause.sourceDoc ?? null,
          sourcePage: clause.sourcePage ?? null, status: 'open',
        }).returning({ id: shortfalls.id })

        const [cr] = await db.insert(clarificationRequests).values({
          tenantId, tenderId, shortfallId: sf.id, bidderId: bidder.bidderId,
          draftedText, deadlineDays: 7,
        }).returning({ id: clarificationRequests.id })

        shortfallItems.push({
          shortfallId: sf.id, bidderId: bidder.bidderId, bidderName: bidder.bidderName,
          discrepancy, sourceDoc: clause.sourceDoc ?? null, sourcePage: clause.sourcePage ?? null,
          clarificationId: cr.id, draftedText, status: 'open',
        })
      }
    }

    return { ...inputData, shortfalls: shortfallItems }
  },
})
