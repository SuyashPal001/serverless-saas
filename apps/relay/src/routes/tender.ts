import { Hono } from 'hono'
import { db, tenders, bidders, tenderClauses } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { mastra } from '../mastra/index.js'
import { ingestTenderDocs } from '../tender/tenderDocIngest.js'
import { ingestBidFromBase64 } from '../tender/tenderBidIngest.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkInternalKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderRoutes = new Hono()

// POST /internal/tender/ingest — read PDFs from TENDER_INPUT_DIR, ingest + extract clauses
tenderRoutes.post('/internal/tender/ingest', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  try {
    const summary = await ingestTenderDocs(tenderId, tenantId)
    return c.json({ status: 'completed', ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/ingest] error', message)
    return c.json({ error: message }, 500)
  }
})

// POST /internal/tender/bid-ingest — accept base64 bid docs, ingest + embed in background
tenderRoutes.post('/internal/tender/bid-ingest', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string; displayLabel?: string; files?: Array<{ name: string; mimeType: string; dataBase64: string }> }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  if (!body.tenderId || !body.tenantId || !body.displayLabel || !body.files?.length) {
    return c.json({ error: 'tenderId, tenantId, displayLabel, files required' }, 400)
  }

  const { tenderId, tenantId, displayLabel, files } = body as Required<typeof body>
  ;(async () => {
    try {
      await ingestBidFromBase64({ tenderId, tenantId, displayLabel, files })
    } catch (err) {
      console.error(`[bid-ingest] background error: ${(err as Error).message}`)
    }
  })()

  return c.json({ status: 'ingesting' }, 202)
})

// POST /internal/tender/run — run full tender evaluation workflow
tenderRoutes.post('/internal/tender/run', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  // Return 202 immediately — evaluation workflow runs in background via PM2-managed relay
  runEvaluationBackground(tenderId, tenantId)
  return c.json({ status: 'running', tenderId }, 202)
})

async function runEvaluationBackground(tenderId: string, tenantId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = await (mastra.getWorkflow('tender-evaluation') as any).createRun()
    await run.start({ inputData: { tenderId, tenantId } })
    console.log(`[tender/run] workflow completed for tenderId=${tenderId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/run] workflow error', message)
  }
}

// POST /internal/tender/technical/run — run ONLY the technical evaluation step (live demo)
// Returns clause-wise compliance sheet with page-level citations.
tenderRoutes.post('/internal/tender/technical/run', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string; bidderId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  const { tenderId, tenantId, bidderId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  // For the live technical run, we import the step directly and call its execute fn
  try {
    const { technicalEvaluateStep } = await import('../mastra/workflows/tenderEvaluationWorkflow.technicalEvaluate.js')

    // Pre-check: clauses must exist before running
    const clauseRows = await db.select({ id: tenderClauses.id }).from(tenderClauses)
      .where(and(eq(tenderClauses.tenderId, tenderId!), eq(tenderClauses.tenantId, tenantId!)))
    if (!clauseRows.length) {
      return c.json({ error: 'No RFP clauses found. Run POST /internal/tender/ingest first to extract clauses from the RFP.' }, 422)
    }

    // Build minimal input that the tech step needs
    const bidderRows = await db.select().from(bidders).where(eq(bidders.tenderId, tenderId))
    let qualifiedBidderIds = bidderId
      ? [bidderId]
      : bidderRows.filter(b => b.status === 'pq_qualified').map(b => b.id)

    // If no qualified bidders (PQ not yet run), auto-run PQ first
    if (!bidderId && qualifiedBidderIds.length === 0) {
      console.log(`[tender/technical/run] no pq_qualified bidders — running PQ first`)
      try {
        const { pqEvaluateStep } = await import('../mastra/workflows/tenderEvaluationWorkflow.pqEvaluate.js')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pqResult = await (pqEvaluateStep as any).execute({ inputData: { tenderId, tenantId } })
        qualifiedBidderIds = pqResult.qualifiedBidderIds ?? []
        console.log(`[tender/technical/run] PQ auto-run complete — qualified: ${qualifiedBidderIds.length}`)
      } catch (pqErr) {
        console.error('[tender/technical/run] PQ auto-run failed:', (pqErr as Error).message)
      }
    }

    if (qualifiedBidderIds.length === 0) {
      return c.json({ error: 'No qualified bidders found after PQ. Ensure bid documents are embedded before running evaluation.' }, 422)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (technicalEvaluateStep as any).execute({
      inputData: { tenderId, tenantId, qualifiedBidderIds, bidders: [], pqResults: [] },
    })

    return c.json({ status: 'completed', techResults: result.techResults ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/technical/run] error', message)
    return c.json({ error: message }, 500)
  }
})
