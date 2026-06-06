import { createStep } from '@mastra/core/workflows'
import { db, bidders, tenders, technicalFindings, tenderClauses } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import * as crypto from 'crypto'
import { retrieveTenderChunks } from '../../tender/tenderRetrieve.js'
import { pqStepOutputSchema, techStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

const GATEWAY_URL = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001').trim()

function bidderFolderId(tenantId: string, tenderId: string, stem: string): string {
  const h = crypto.createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}

interface ClauseRow {
  clauseNo: string
  title: string
  content: string
}

interface EvalResult {
  status: 'complied' | 'deviation' | 'not_found' | 'cannot_evaluate'
  narration: string
  bidderResponse?: string
  sourceDoc?: string | null
  sourcePage?: number | null
}

async function evaluateClause(
  model: string,
  clause: ClauseRow,
  retrievedText: string,
  bidderName: string,
): Promise<EvalResult> {
  const systemPrompt = `You are a government procurement Technical Evaluation Committee (TEC) member under GFR 2017.
Evaluate ONE RFP clause against the extracted bid text provided. Base your finding ONLY on the bid text below — never guess or infer.

Status values:
- "complied": bid explicitly meets the requirement
- "deviation": bid partially meets or proposes an alternative
- "not_found": requirement is not addressed in the extracted bid text
- "cannot_evaluate": bid text is insufficient to assess

Return ONLY valid JSON, no markdown:
{"status":"complied|deviation|not_found|cannot_evaluate","narration":"one factual sentence citing the bid text","bidderResponse":"verbatim or paraphrase from bid","sourceDoc":"document name","sourcePage":12}`

  const userPrompt = `Bidder: ${bidderName}
Clause ${clause.clauseNo} — ${clause.title}
RFP Requirement: ${clause.content}

Extracted bid text:
${retrievedText || '(no relevant text found in indexed bid documents)'}`

  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }),
  })

  if (!res.ok) {
    throw new Error(`Inference gateway ${res.status} for clause ${clause.clauseNo}`)
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const rawContent = (data.choices?.[0]?.message?.content ?? '').trim()
  if (!rawContent) throw new Error(`Empty model response for clause ${clause.clauseNo}`)
  // Strip markdown fences — Vertex doesn't enforce response_format: json_object
  const raw = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const parsed = JSON.parse(raw) as Partial<EvalResult>
  const validStatuses = ['complied', 'deviation', 'not_found', 'cannot_evaluate']
  const status = validStatuses.includes(parsed.status ?? '')
    ? parsed.status as EvalResult['status']
    : 'cannot_evaluate'

  return {
    status,
    narration: parsed.narration ?? '',
    bidderResponse: parsed.bidderResponse,
    sourceDoc: parsed.sourceDoc ?? null,
    sourcePage: parsed.sourcePage ?? null,
  }
}

export const technicalEvaluateStep = createStep({
  id: 'tender-technical-evaluate',
  inputSchema: pqStepOutputSchema,
  outputSchema: techStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, qualifiedBidderIds } = inputData

    const model = (process.env.TENDER_MODEL ?? '').trim()
    if (!model) {
      throw new Error(
        'TENDER_MODEL env var is not set. Set it to an on-prem model ID (e.g. ollama/qwen3:8b) in apps/relay/.env and restart.'
      )
    }

    const clauses = await db.select().from(tenderClauses).where(
      and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId))
    )
    if (clauses.length === 0) {
      throw new Error(
        `No clauses found for tenderId=${tenderId}. ` +
        `Run POST /internal/tender/ingest first to ingest rfp.pdf and extract clauses.`
      )
    }

    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    const techResults = []

    for (const bidderId of qualifiedBidderIds) {
      const [bidder] = await db.select().from(bidders).where(
        and(eq(bidders.id, bidderId), eq(bidders.tenantId, tenantId))
      )
      if (!bidder) continue

      // Derive the folder ID that was used when ingesting this bidder's docs.
      // Convention: stem = bidder display label lowercased + hyphenated (e.g. "bidder-a")
      const stem = bidder.displayLabel.toLowerCase().replace(/\s+/g, '-')
      const folderId = bidderFolderId(tenantId, tenderId, stem)

      console.log(`[technicalEvaluate] evaluating ${bidder.name} (${clauses.length} clauses)`)

      const savedClauses = []
      for (const clause of clauses) {
        // Retrieve relevant chunks from this bidder's indexed documents
        let retrievedText = ''
        try {
          const chunks = await retrieveTenderChunks(
            `${clause.clauseNo} ${clause.title} ${clause.content}`,
            tenantId, folderId, 5, 0.3
          )
          retrievedText = chunks.map((ch, i) =>
            `[${i + 1}] ${ch.documentName} p.${ch.chunkIndex + 1}\n${ch.content}`
          ).join('\n\n')
        } catch (err) {
          console.warn(`[technicalEvaluate] RAG failed for clause ${clause.clauseNo}:`, (err as Error).message)
          // retrievedText stays empty — model sees "(no relevant text found)"
        }

        let result: EvalResult
        try {
          result = await evaluateClause(model, clause, retrievedText, bidder.name)
        } catch (err) {
          const msg = (err as Error).message
          console.error(`[technicalEvaluate] model error clause ${clause.clauseNo}:`, msg)
          result = { status: 'cannot_evaluate', narration: `Evaluation error: ${msg}` }
        }

        const [row] = await db.insert(technicalFindings).values({
          tenantId, tenderId, bidderId,
          clauseNo: clause.clauseNo,
          clauseTitle: clause.title,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: result.status as any,
          narration: result.narration,
          rfpRequirement: clause.content,
          bidderResponse: result.bidderResponse ?? null,
          sourceDoc: result.sourceDoc ?? null,
          sourcePage: result.sourcePage ?? null,
          runId: 'live',
        }).returning({ id: technicalFindings.id })

        savedClauses.push({
          clauseNo: clause.clauseNo,
          clauseTitle: clause.title,
          status: result.status,
          narration: result.narration,
          rfpRequirement: clause.content,
          bidderResponse: result.bidderResponse,
          sourceDoc: result.sourceDoc ?? null,
          sourcePage: result.sourcePage ?? null,
          findingId: row.id,
        })
      }

      await db.update(bidders).set({ status: 'tech_evaluated' }).where(eq(bidders.id, bidderId))

      const compliedCount  = savedClauses.filter(c => c.status === 'complied').length
      const deviationCount = savedClauses.filter(c => c.status === 'deviation').length
      const notFoundCount  = savedClauses.filter(c => c.status === 'not_found').length

      techResults.push({
        bidderId, bidderName: bidder.name, displayLabel: bidder.displayLabel,
        clauses: savedClauses, compliedCount, deviationCount, notFoundCount,
      })
    }

    return { ...inputData, techResults, liveRunBidderId: qualifiedBidderIds[0] ?? undefined }
  },
})
