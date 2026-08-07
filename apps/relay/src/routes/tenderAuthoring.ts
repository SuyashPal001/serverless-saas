import { Hono } from 'hono'
import { db, tenders, tenderClauses, clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { mastra } from '../mastra/index.js'
import { tenderAuthorAgent } from '../mastra/agents/tenderAuthorAgent.js'
import { extractJsonObject } from '../tender/tenderAuthoringJson.js'
import { computeApplicableClauses, enforceRequiredClauses } from '../mastra/rules/tenderClauseRules.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderAuthoringRoutes = new Hono()

// POST /internal/tender/author — generate full RFP for a tender via tenderAuthoringWorkflow
tenderAuthoringRoutes.post('/internal/tender/author', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  // Return 202 immediately — relay stays alive via PM2, workflow runs in background
  runAuthoringWorkflow(tenderId, tenantId)
  return c.json({ status: 'generating', tenderId }, 202)
})

async function runAuthoringWorkflow(tenderId: string, tenantId: string): Promise<void> {
  try {
    console.log(`[tender/author] starting tenderAuthoringWorkflow tenderId=${tenderId}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = await (mastra.getWorkflow('tender-authoring') as any).createRun()
    const result = await run.start({ inputData: { tenderId, tenantId } })
    if (result?.status !== 'success') {
      console.error(`[tender/author] workflow status=${result?.status} tenderId=${tenderId}`, result?.error ?? result)
      await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tenderId))
      return
    }
    console.log(`[tender/author] workflow completed tenderId=${tenderId}`, result?.result ?? result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/author] workflow failed', message)
    await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tenderId))
  }
}

// POST /internal/tender/section/regenerate — redraft one section with optional steer
tenderAuthoringRoutes.post('/internal/tender/section/regenerate', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string; sectionId?: string; steer?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId, sectionId, steer } = body
  if (!tenderId || !tenantId || !sectionId) return c.json({ error: 'tenderId, tenantId, sectionId required' }, 400)

  const [section] = await db.select().from(rfpSections).where(eq(rfpSections.id, sectionId))
  if (!section) return c.json({ error: 'section not found' }, 404)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  const libraryRows = await db.select().from(clauseLibrary)
    .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))
  const libraryText = libraryRows.map(cl => `${cl.code} [${cl.category}] "${cl.title}": ${cl.content}`).join('\n')
  const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
  const requirementText = tender.requirementText ?? ''
  const { mandatory, annexures } = computeApplicableClauses({ budget: tender.budget }, templateFields)
  const annexureSpec = annexures.find(a => a.sectionNo === section.sectionNo)

  const sectionFormat = singleSectionOutputFormat(section.sectionNo, section.blockType)
  const mandatoryBlock = section.sectionNo === 'S8' && mandatory.length
    ? `\nMANDATORY CLAUSES — this section MUST include these, source:"library", with the exact clauseNo shown:\n${mandatory.map(m => `- Clause ${m.clauseNo} "${m.title}" (libraryRef "${m.libraryRef}"): ${m.reason}`).join('\n')}\n`
    : ''
  const annexureBlock = annexureSpec
    ? `\nMANDATORY ANNEXURE SECTION — this is boilerplate, not freshly drafted prose: paste the full text of library clause "${annexureSpec.libraryRef}" verbatim as this section's content.text.\n`
    : ''
  const prompt = `Redraft ONLY section ${section.sectionNo} of this RFP. Return a single JSON section object.

Title: ${tender.title}
Department: ${tender.department}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}
${mandatoryBlock}${annexureBlock}
Requirement Document:
${requirementText.slice(0, 200000) || '(Draft from title and department context.)'}

Clause library (set source:"library" + libraryRef to the clause code when reusing):
${libraryText || '(None)'}
${steer ? `\nOfficer steer: ${steer}` : ''}

OUTPUT FORMAT — return ONLY this JSON object, no markdown, no array:
${sectionFormat}`

  try {
    const agentResult = await tenderAuthorAgent.generate(prompt)
    const agentText = (agentResult.text ?? '').trim()
    const parsed = JSON.parse(extractJsonObject(agentText))
    if (!parsed.content) throw new Error('Regenerated section missing content field')

    let finalContent = parsed.content
    if (section.sectionNo === 'S8') {
      const [patched] = enforceRequiredClauses(
        [{ sectionNo: 'S8', title: section.title, blockType: section.blockType, content: parsed.content }],
        mandatory,
        libraryRows
      )
      finalContent = patched.content
    }

    const newVersion = section.version + 1
    await db.insert(rfpSectionVersions).values({
      sectionId, tenderId, tenantId, version: section.version,
      content: section.content as object, changeNote: `regenerate: ${steer ?? 'no steer'}`,
    })
    await db.update(rfpSections)
      .set({ content: finalContent, version: newVersion, updatedAt: new Date() })
      .where(eq(rfpSections.id, sectionId))
    return c.json({ status: 'completed', sectionId, version: newVersion, content: finalContent })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function singleSectionOutputFormat(sectionNo: string, blockType: string): string {
  const base = `{"sectionNo":"${sectionNo}","title":"...","blockType":"${blockType}","content":`
  if (blockType === 'prose') {
    if (sectionNo === 'S7') return base + `{"text":"...","clauses":[{"clauseNo":"7.1","title":"Bid Opening Sequence","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.2","title":"Technical Qualification","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.3","title":"Financial Evaluation","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.4","title":"Award","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.5","title":"QCBS (if applicable)","text":"...","source":"drafted","libraryRef":null}]}}`
    if (sectionNo === 'S8') return base + `{"text":"...","clauses":[{"clauseNo":"8.1","title":"Payment Terms","text":"...","source":"library","libraryRef":"CL-013"},{"clauseNo":"8.2","title":"Performance Bank Guarantee","text":"...","source":"library","libraryRef":"CL-015"},{"clauseNo":"8.3","title":"Liquidated Damages","text":"...","source":"library","libraryRef":"CL-014"},{"clauseNo":"8.4","title":"Warranty / AMC","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.5","title":"Security & Compliance","text":"...","source":"library","libraryRef":"CL-016"},{"clauseNo":"8.6","title":"Confidentiality","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.7","title":"Intellectual Property","text":"...","source":"library","libraryRef":"CL-020"},{"clauseNo":"8.8","title":"Termination","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.9","title":"Governing Law & Dispute Resolution","text":"...","source":"library","libraryRef":"CL-019"}]}}`
    return base + `{"text":"...","clauses":[{"clauseNo":"${sectionNo}.1","title":"...","text":"...","source":"drafted","libraryRef":null}]}}`
  }
  if (blockType === 'criteria-table')
    return base + `{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}}`
  if (blockType === 'spec-table')
    return base + `{"rows":[{"metric":"...","target":"...","measurement":"..."}],"clauses":[]}}`
  if (blockType === 'line-item-table')
    return base + `{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}}`
  if (blockType === 'annexure')
    return base + `{"text":"...","clauses":[]}}`
  return base + `{}}`
}
