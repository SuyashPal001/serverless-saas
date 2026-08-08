// apps/relay/src/routes/tenderProposal.ts
import { Hono } from 'hono'
import { db, tenders } from '@serverless-saas/database'
import { eq } from 'drizzle-orm'
import { generateProposal } from '../tender/tenderProposal.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkInternalKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderProposalRoutes = new Hono()

// POST /internal/tender/proposal/generate — compile and store a new proposal version
tenderProposalRoutes.post('/internal/tender/proposal/generate', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  try {
    const result = await generateProposal(tenderId, tenantId)
    return c.json({ status: 'completed', ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/proposal/generate] error', message)
    return c.json({ error: message }, 500)
  }
})
