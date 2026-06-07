import { createStep } from '@mastra/core/workflows'
import { db, bidders, technicalFindings, tenderClauses, shortfalls, clarificationRequests } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import * as crypto from 'crypto'
import { retrieveTenderChunks } from '../../tender/tenderRetrieve.js'
import { pqStepOutputSchema, techStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'
import { tenderEvaluatorAgent } from '../agents/tenderEvaluatorAgent.js'

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

async function callEvaluatorAgent(
  clause: ClauseRow,
  retrievedText: string,
  bidderName: string,
): Promise<EvalResult> {
  const prompt = `Bidder: ${bidderName}
Clause ${clause.clauseNo} — ${clause.title}
RFP Requirement: ${clause.content}

Extracted bid text:
${retrievedText || '(no relevant text found in indexed bid documents)'}`

  const result = await tenderEvaluatorAgent.generate(prompt)

  const rawText = (result.text ?? '').trim()
  if (!rawText) throw new Error(`Empty agent response for clause ${clause.clauseNo}`)
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const parsed = JSON.parse(raw) as Partial<EvalResult>
  const validStatuses = ['complied', 'deviation', 'not_found', 'cannot_evaluate']
  const status = validStatuses.includes(parsed.status ?? '')
    ? parsed.status as EvalResult['status']
    : 'cannot_evaluate'

  const rawPage = parsed.sourcePage
  const sourcePage = typeof rawPage === 'number' && Number.isFinite(rawPage)
    ? Math.trunc(rawPage)
    : typeof rawPage === 'string' ? (parseInt(rawPage, 10) || null)
    : null

  return {
    status,
    narration: parsed.narration ?? '',
    bidderResponse: parsed.bidderResponse ?? undefined,
    sourceDoc: parsed.sourceDoc ?? null,
    sourcePage,
  }
}

export const technicalEvaluateStep = createStep({
  id: 'tender-technical-evaluate',
  inputSchema: pqStepOutputSchema,
  outputSchema: techStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, qualifiedBidderIds } = inputData

    const clauses = await db.select().from(tenderClauses).where(
      and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId))
    )
    if (clauses.length === 0) {
      throw new Error(
        `No clauses found for tenderId=${tenderId}. ` +
        `Run POST /internal/tender/ingest first to ingest rfp.pdf and extract clauses.`
      )
    }

    // Wipe all prior technical findings for this tender up-front (idempotent re-run).
    // shortfalls.tech_finding_id → technicalFindings.id has no cascade, so clear dependents first.
    await db.delete(clarificationRequests).where(eq(clarificationRequests.tenderId, tenderId))
    await db.delete(shortfalls).where(and(eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId)))
    await db.delete(technicalFindings).where(eq(technicalFindings.tenderId, tenderId))

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
          result = await callEvaluatorAgent(clause, retrievedText, bidder.name)
        } catch (err) {
          const msg = (err as Error).message
          console.error(`[technicalEvaluate] model error clause ${clause.clauseNo}:`, msg)
          result = { status: 'cannot_evaluate', narration: `Evaluation error: ${msg}` }
        }

        let findingId: string | undefined
        try {
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
          findingId = row.id
        } catch (insertErr) {
          console.error(`[technicalEvaluate] insert error clause ${clause.clauseNo} bidder ${bidder.name}:`, (insertErr as Error).message)
          result = { status: 'cannot_evaluate', narration: `Save error: ${(insertErr as Error).message}`, sourceDoc: null, sourcePage: null }
        }

        savedClauses.push({
          clauseNo: clause.clauseNo,
          clauseTitle: clause.title,
          status: result.status,
          narration: result.narration,
          rfpRequirement: clause.content,
          bidderResponse: result.bidderResponse ?? undefined,
          sourceDoc: result.sourceDoc ?? null,
          sourcePage: result.sourcePage ?? null,
          findingId,
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
