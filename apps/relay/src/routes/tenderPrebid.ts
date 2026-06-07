import { Hono } from 'hono'
import { db, tenders, rfpSections, clauseLibrary } from '@serverless-saas/database'
import { eq, and, asc } from 'drizzle-orm'
import { tenderAuthorAgent } from '../mastra/agents/tenderAuthorAgent.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderPrebidRoutes = new Hono()

// POST /internal/tender/prebid/draft
// AI-draft a response to a pre-bid query, grounded in real RFP sections + clause library.
tenderPrebidRoutes.post('/internal/tender/prebid/draft', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string; queryText?: string; queryNo?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId, queryText, queryNo } = body
  if (!tenderId || !tenantId || !queryText) return c.json({ error: 'tenderId, tenantId, queryText required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  const sections = await db.select().from(rfpSections)
    .where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId)))
    .orderBy(asc(rfpSections.sectionNo))

  const libraryRows = await db.select().from(clauseLibrary)
    .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))

  const rfpContext = sections.map(s => {
    const content = (s.content ?? {}) as Record<string, unknown>
    const text = s.blockType === 'prose'
      ? (content.text as string ?? '')
      : JSON.stringify(content).slice(0, 400)
    return `${s.sectionNo}. ${s.title} [${s.blockType}]:\n${text}`
  }).join('\n\n')

  const libraryText = libraryRows.map(cl => `${cl.code}: ${cl.title} — ${cl.content.slice(0, 120)}`).join('\n')

  const prompt = `You are a government procurement officer responding to a pre-bid query on an RFP.

Tender: ${tender.title}
Department: ${tender.department}
Query reference: ${queryNo ?? 'N/A'}

PRE-BID QUERY FROM BIDDER:
"${queryText}"

RFP SECTIONS (your answer must be grounded in these):
${rfpContext.slice(0, 5000)}

CLAUSE LIBRARY (for reference):
${libraryText.slice(0, 1500) || '(None)'}

RULES (CVC guidelines):
- Answer must be grounded in the RFP — cite the specific clause/section being clarified.
- Do NOT allow any change to technical specifications or pricing in your response.
- Time-neutral — do not commit to deadline changes unless a corrigendum is being issued.
- Factual, formal, government register. Under 120 words.
- If the query requires a formal amendment, note "A corrigendum will be issued" but do not pre-commit to the amendment content.

Return ONLY the response body text (no headers, no subject line).`

  try {
    const result = await tenderAuthorAgent.generate(prompt)
    const draftedText = (result.text ?? '').trim()
    if (!draftedText) throw new Error('Agent returned empty response')
    return c.json({ draftedText })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})
