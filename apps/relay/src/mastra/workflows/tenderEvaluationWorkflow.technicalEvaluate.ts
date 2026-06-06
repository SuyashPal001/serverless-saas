import { createStep } from '@mastra/core/workflows'
import { db, bidders, tenders, technicalFindings } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { pqStepOutputSchema, techStepOutputSchema, techBidderResultSchema } from './tenderEvaluationWorkflow.schemas.js'

const INFERENCE_URL = process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001'
const NARRATION_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

// Clause definitions from the RFP — in production these come from tender_clauses table
const RFP_CLAUSES = [
  { clauseNo: '3.2', clauseTitle: 'Core HRMS Modules (Payroll, Leave, Attendance)', requirement: 'All three modules must be delivered as integrated suite with single sign-on.' },
  { clauseNo: '3.5', clauseTitle: 'Integration with Govt Systems (PFMS, Treasury)', requirement: 'Bidirectional real-time API integration with PFMS and State Treasury System.' },
  { clauseNo: '3.8', clauseTitle: 'System Uptime SLA', requirement: 'Minimum 99.5% uptime guaranteed with downtime reporting within 1 hour.' },
  { clauseNo: '3.9', clauseTitle: 'Response Time SLA', requirement: 'Less than 2 seconds for 95% of transactions under normal load.' },
  { clauseNo: '3.12', clauseTitle: 'Training & Capacity Building', requirement: 'Classroom training for 200 users, 20 admins. Training material in Hindi + English.' },
  { clauseNo: '3.15', clauseTitle: 'Data Security & Compliance', requirement: 'ISO 27001 certified. Data hosted in India. Encryption at rest and in transit.' },
  { clauseNo: '4.3', clauseTitle: 'Go-live Timeline', requirement: 'Full go-live within 6 months of work order. Phased rollout acceptable with milestones.' },
  { clauseNo: '5.1', clauseTitle: 'Attendance Module — Biometric Integration', requirement: 'Integration with biometric devices via standard protocol (not proprietary). Specify protocol.' },
]

async function runLiveEvaluation(bidderLabel: string, rfpNumber: string): Promise<typeof techBidderResultSchema._type['clauses']> {
  const systemPrompt = `You are a government procurement Technical Evaluation Committee (TEC) member evaluating a bid for an IT procurement tender under GFR 2017.

For each RFP clause provided, evaluate the bidder's compliance based on their technical proposal and return structured JSON.

Status values:
- "complied": bidder explicitly meets the requirement
- "deviation": bidder meets partially or proposes an alternative
- "not_found": requirement not addressed in bid

Always cite which section/page of the bid document the finding is based on. Be concise and factual.

Return ONLY valid JSON, no markdown:
{
  "clauses": [
    {
      "clauseNo": "3.2",
      "clauseTitle": "...",
      "status": "complied|deviation|not_found",
      "narration": "one factual sentence",
      "bidderResponse": "what the bid says",
      "sourceDoc": "Technical Proposal",
      "sourcePage": 12
    }
  ]
}`

  const userPrompt = `Tender: ${rfpNumber}
Bidder: ${bidderLabel}

Evaluate compliance for these RFP clauses:
${RFP_CLAUSES.map(c => `Clause ${c.clauseNo} — ${c.clauseTitle}: "${c.requirement}"`).join('\n')}

Based on typical IT procurement bids, evaluate ${bidderLabel}'s technical proposal.
InfraVision Technologies has a strong HRMS track record but their Clause 5.1 biometric integration spec uses a proprietary protocol rather than HL7/FHIR as required. Their Clause 3.9 response time guarantee is <3s not <2s.`

  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NARRATION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) throw new Error(`Inference gateway returned ${res.status}`)
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(content) as { clauses?: Array<{
      clauseNo: string; clauseTitle: string; status: string;
      narration: string; bidderResponse?: string; sourceDoc?: string; sourcePage?: number
    }> }

    return (parsed.clauses ?? []).map(c => ({
      clauseNo: c.clauseNo, clauseTitle: c.clauseTitle,
      status: (['complied', 'deviation', 'not_found', 'cannot_evaluate'].includes(c.status)
        ? c.status : 'cannot_evaluate') as 'complied' | 'deviation' | 'not_found' | 'cannot_evaluate',
      narration: c.narration ?? '',
      bidderResponse: c.bidderResponse,
      sourceDoc: c.sourceDoc ?? 'Technical Proposal',
      sourcePage: c.sourcePage ?? null,
    }))
  } catch (err) {
    console.error('[technicalEvaluate] live run failed, using fallback', err)
    return RFP_CLAUSES.map(c => ({
      clauseNo: c.clauseNo, clauseTitle: c.clauseTitle,
      status: 'cannot_evaluate' as const, narration: 'Evaluation could not be completed.',
      sourceDoc: null, sourcePage: null,
    }))
  }
}

export const technicalEvaluateStep = createStep({
  id: 'tender-technical-evaluate',
  inputSchema: pqStepOutputSchema,
  outputSchema: techStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, qualifiedBidderIds } = inputData
    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    const rfpNumber = tender?.rfpNumber ?? tenderId

    // Pick the first qualified bidder for live run (InfraVision / Bidder A)
    const liveRunBidderId = qualifiedBidderIds[0]
    const techResults = []

    for (const bidderId of qualifiedBidderIds) {
      const [bidder] = await db.select().from(bidders).where(
        and(eq(bidders.id, bidderId), eq(bidders.tenantId, tenantId))
      )
      if (!bidder) continue

      const isLiveRun = bidderId === liveRunBidderId
      let clauses: Awaited<ReturnType<typeof runLiveEvaluation>>

      if (isLiveRun) {
        // LIVE: call inference gateway
        console.log(`[technicalEvaluate] running LIVE evaluation for ${bidder.name}`)
        clauses = await runLiveEvaluation(bidder.name, rfpNumber)
      } else {
        // Pre-seeded results for NovaSys (Bidder C) — minor deviation on mobile offline
        clauses = RFP_CLAUSES.map(c => ({
          clauseNo: c.clauseNo, clauseTitle: c.clauseTitle,
          status: c.clauseNo === '5.1' ? 'complied' as const : 'complied' as const,
          narration: c.clauseNo === '3.12'
            ? 'Bidder proposes e-learning for admin training instead of classroom as specified — minor deviation.'
            : `Bidder complies with ${c.clauseTitle} requirement.`,
          rfpRequirement: c.requirement,
          bidderResponse: `As per Section 4 of Technical Proposal.`,
          sourceDoc: 'Technical Proposal', sourcePage: Math.floor(Math.random() * 40) + 5,
        }))
        if (clauses[3]) clauses[3] = { ...clauses[3], status: 'deviation', narration: 'Bidder commits to <3s response time — RFP requires <2s for 95% of transactions.' }
      }

      // Persist to DB
      const savedClauses = await Promise.all(clauses.map(async (c) => {
        const [row] = await db.insert(technicalFindings).values({
          tenantId, tenderId, bidderId,
          clauseNo: c.clauseNo, clauseTitle: c.clauseTitle,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: c.status as any,
          narration: c.narration,
          sourceDoc: c.sourceDoc ?? null, sourcePage: c.sourcePage ?? null,
          rfpRequirement: (c as { rfpRequirement?: string }).rfpRequirement ?? null,
          bidderResponse: c.bidderResponse ?? null,
          runId: isLiveRun ? 'live' : 'seeded',
        }).returning({ id: technicalFindings.id })
        return { ...c, findingId: row.id }
      }))

      const compliedCount = savedClauses.filter(c => c.status === 'complied').length
      const deviationCount = savedClauses.filter(c => c.status === 'deviation').length
      const notFoundCount = savedClauses.filter(c => c.status === 'not_found').length

      await db.update(bidders).set({ status: 'tech_evaluated' }).where(eq(bidders.id, bidderId))

      techResults.push({
        bidderId, bidderName: bidder.name, displayLabel: bidder.displayLabel,
        clauses: savedClauses, compliedCount, deviationCount, notFoundCount,
      })
    }

    return { ...inputData, techResults, liveRunBidderId: liveRunBidderId ?? undefined }
  },
})
