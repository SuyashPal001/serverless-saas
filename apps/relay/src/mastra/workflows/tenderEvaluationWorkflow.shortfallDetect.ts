import { createStep } from '@mastra/core/workflows'
import { db, shortfalls, clarificationRequests, tenderOfficerActions } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { techStepOutputSchema, shortfallStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

const INFERENCE_URL = process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001'
const NARRATION_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

async function draftClarification(discrepancy: string, clauseRef: string, clauseTitle: string): Promise<string> {
  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NARRATION_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a government procurement officer drafting a clarification request.
CVC rules (non-negotiable):
- Time-bound: specify a deadline (use 7 working days)
- Must NOT ask the bidder to change their quoted price or technical specifications
- Must NOT introduce any new requirement not in the RFP
- Factual and non-leading; state only what was observed
- Under 80 words
Return ONLY the letter body text, no headers or subject line.`,
          },
          {
            role: 'user',
            content: `Clause reference: ${clauseRef} — ${clauseTitle}\nObservation: ${discrepancy}\nDraft the clarification request.`,
          },
        ],
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || fallbackClarification(discrepancy, clauseRef)
  } catch {
    return fallbackClarification(discrepancy, clauseRef)
  }
}

function fallbackClarification(discrepancy: string, clauseRef: string): string {
  return `With reference to your technical bid, it is observed that ${clauseRef} requires clarification regarding: ${discrepancy}. You are requested to provide the requisite clarification within 7 working days. No change in quoted price or technical specifications shall be permitted.`
}

export const shortfallDetectStep = createStep({
  id: 'tender-shortfall-detect',
  inputSchema: techStepOutputSchema,
  outputSchema: shortfallStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, techResults, pqResults } = inputData
    const shortfallItems = []

    // Idempotency: wipe prior shortfall run for this tender
    const existingSfs = await db.select({ id: shortfalls.id }).from(shortfalls)
      .where(and(eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId)))
    if (existingSfs.length) {
      await db.delete(clarificationRequests)
        .where(and(eq(clarificationRequests.tenderId, tenderId), eq(clarificationRequests.tenantId, tenantId)))
      await db.delete(shortfalls)
        .where(and(eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId)))
    }

    // ── Technical findings: deviation + not_found ─────────────────────────────
    for (const bidder of techResults) {
      const flagged = bidder.clauses.filter(
        c => c.status === 'deviation' || c.status === 'not_found'
      )

      for (const clause of flagged) {
        const discrepancy = clause.status === 'deviation'
          ? clause.narration
          : `Clause ${clause.clauseNo} (${clause.clauseTitle}): requirement not addressed in bid.`

        const [sf] = await db.insert(shortfalls).values({
          tenantId, tenderId, bidderId: bidder.bidderId,
          techFindingId: (clause as { findingId?: string }).findingId ?? null,
          discrepancy, sourceDoc: clause.sourceDoc ?? null,
          sourcePage: clause.sourcePage ?? null, status: 'open',
        }).returning({ id: shortfalls.id })

        const draftedText = await draftClarification(discrepancy, clause.clauseNo, clause.clauseTitle)

        const [cr] = await db.insert(clarificationRequests).values({
          tenantId, tenderId, shortfallId: sf.id, bidderId: bidder.bidderId,
          draftedText, deadlineDays: 7,
        }).returning({ id: clarificationRequests.id })

        await db.insert(tenderOfficerActions).values({
          tenantId, tenderId, findingType: 'technical',
          findingId: (clause as { findingId?: string }).findingId ?? null,
          action: 'accept', actorRole: 'system',
          rationale: `Auto-flagged: ${clause.status} on clause ${clause.clauseNo}`,
        })

        shortfallItems.push({
          shortfallId: sf.id, bidderId: bidder.bidderId, bidderName: bidder.bidderName,
          discrepancy, sourceDoc: clause.sourceDoc ?? null, sourcePage: clause.sourcePage ?? null,
          clarificationId: cr.id, draftedText, status: 'open',
        })
      }
    }

    // ── PQ findings: cannot_evaluate rules (missing / unverifiable docs) ──────
    for (const pqBidder of pqResults) {
      const cannotEvalRules = pqBidder.findings.filter(f => f.status === 'cannot_evaluate')
      for (const rule of cannotEvalRules) {
        const discrepancy = rule.narration || `PQ criterion "${rule.ruleName}" could not be evaluated — document missing or unreadable.`

        const [sf] = await db.insert(shortfalls).values({
          tenantId, tenderId, bidderId: pqBidder.bidderId,
          techFindingId: null,
          discrepancy, sourceDoc: rule.sourceDoc ?? null,
          sourcePage: rule.sourcePage ?? null, status: 'open',
        }).returning({ id: shortfalls.id })

        const draftedText = await draftClarification(discrepancy, rule.ruleId, rule.ruleName)

        const [cr] = await db.insert(clarificationRequests).values({
          tenantId, tenderId, shortfallId: sf.id, bidderId: pqBidder.bidderId,
          draftedText, deadlineDays: 7,
        }).returning({ id: clarificationRequests.id })

        await db.insert(tenderOfficerActions).values({
          tenantId, tenderId, findingType: 'pq',
          findingId: (rule as { findingId?: string }).findingId ?? null,
          action: 'accept', actorRole: 'system',
          rationale: `Auto-flagged: cannot_evaluate on PQ rule ${rule.ruleId}`,
        })

        shortfallItems.push({
          shortfallId: sf.id, bidderId: pqBidder.bidderId, bidderName: pqBidder.bidderName,
          discrepancy, sourceDoc: rule.sourceDoc ?? null, sourcePage: rule.sourcePage ?? null,
          clarificationId: cr.id, draftedText, status: 'open',
        })
      }
    }

    console.log(`[shortfallDetect] tenderId=${tenderId} shortfalls=${shortfallItems.length}`)
    return { ...inputData, shortfalls: shortfallItems }
  },
})
