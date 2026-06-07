import { Hono } from 'hono'
import { db, tenders, tenderClauses, clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { tenderAuthorAgent } from '../mastra/agents/tenderAuthorAgent.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderAuthoringRoutes = new Hono()

// POST /internal/tender/author — generate full RFP for a tender
tenderAuthoringRoutes.post('/internal/tender/author', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  const libraryRows = await db.select().from(clauseLibrary)
    .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))

  const libraryText = libraryRows.map(cl =>
    `${cl.code} [${cl.category}] "${cl.title}": ${cl.content}`
  ).join('\n')

  const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
  const requirementText = tender.requirementText ?? ''

  try {
    const agentResult = await tenderAuthorAgent.generate(
      buildUserPrompt({ tender, templateFields, requirementText, libraryText })
    )
    const agentText = (agentResult.text ?? '').trim()
    console.log('[tender/author] agent response length:', agentText.length, 'preview:', agentText.slice(0, 120))
    const rawParsed = JSON.parse(extractJsonObject(agentText))
    const parsed: { sections: unknown[] } = Array.isArray(rawParsed)
      ? { sections: rawParsed }
      : Array.isArray(rawParsed?.sections)
        ? rawParsed as { sections: unknown[] }
        : Array.isArray(rawParsed?.rfp?.sections)
          ? { sections: rawParsed.rfp.sections }
          : { sections: [] }
    if (!parsed.sections.length) throw new Error(`Model returned 0 sections. Preview: ${agentText.slice(0, 200)}`)

    await saveRfpSections(tenderId, tenantId, parsed.sections, libraryRows)
    await db.update(tenders).set({ authoringStatus: 'completed' }).where(eq(tenders.id, tenderId))

    return c.json({ status: 'completed', tenderId, sectionCount: parsed.sections.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/author] error', message)
    await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tenderId))
    return c.json({ error: message }, 500)
  }
})

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

  const sectionFormat = singleSectionOutputFormat(section.sectionNo, section.blockType)
  const prompt = `Redraft ONLY section ${section.sectionNo} of this RFP. Return a single JSON section object.

Title: ${tender.title}
Department: ${tender.department}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}

Requirement Document:
${requirementText.slice(0, 6000) || '(Draft from title and department context.)'}

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
    const newVersion = section.version + 1
    await db.insert(rfpSectionVersions).values({
      sectionId, tenderId, tenantId, version: section.version,
      content: section.content as object, changeNote: `regenerate: ${steer ?? 'no steer'}`,
    })
    await db.update(rfpSections)
      .set({ content: parsed.content, version: newVersion, updatedAt: new Date() })
      .where(eq(rfpSections.id, sectionId))
    return c.json({ status: 'completed', sectionId, version: newVersion, content: parsed.content })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the first complete {...} JSON object from model output.
 * Strips markdown fences, then uses brace-depth tracking so trailing
 * commentary (which may contain { or }) doesn't corrupt the slice.
 */
function extractJsonObject(text: string): string {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  const start = stripped.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in agent output')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1) }
  }
  throw new Error('Unmatched braces in agent JSON output')
}

interface AuthorPromptArgs {
  tender: { title: string; department: string; budget: string | null }
  templateFields: Record<string, unknown>
  requirementText: string
  libraryText: string
}

function buildUserPrompt({ tender, templateFields, requirementText, libraryText }: AuthorPromptArgs): string {
  return `Draft a complete 8-section government RFP with the following details.

Title: ${tender.title}
Department: ${tender.department}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}
Key Dates: ${JSON.stringify(templateFields.keyDates ?? {})}

Requirement Document:
${requirementText.slice(0, 6000) || '(Draft from title and department context.)'}

Clause library (set source:"library" + libraryRef to the clause code when reusing):
${libraryText || '(None)'}

OUTPUT FORMAT — return ONLY this JSON, no markdown:
{"sections":[{"sectionNo":"S1","title":"Notice Inviting Tender & Overview","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"1.1","title":"...","text":"...","source":"drafted","libraryRef":null}]}},{"sectionNo":"S2","title":"Eligibility / Pre-Qualification Criteria","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S3","title":"Scope of Work","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S4","title":"Technical Specifications","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S5","title":"Service Levels (SLA / KPI)","blockType":"spec-table","content":{"rows":[{"metric":"...","target":"...","measurement":"..."}],"clauses":[]}},{"sectionNo":"S6","title":"Bill of Quantities","blockType":"line-item-table","content":{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}},{"sectionNo":"S7","title":"Evaluation Methodology","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S8","title":"Contract Terms, Compliance & Security","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"8.1","title":"...","text":"...","source":"library","libraryRef":"CL-013"}]}}]}`
}

interface LibraryRow { id: string; code: string; category: string; title: string; content: string; tags: unknown; version: number; isActive: boolean; tenantId: string; createdAt: Date; updatedAt: Date }

async function saveRfpSections(
  tenderId: string, tenantId: string,
  sections: unknown[], _library: LibraryRow[]
): Promise<void> {
  await db.delete(rfpSections).where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId)))

  for (const sec of sections as Array<{ sectionNo: string; title: string; blockType: string; content: object }>) {
    await db.insert(rfpSections).values({
      tenderId, tenantId,
      sectionNo: sec.sectionNo, title: sec.title,
      blockType: sec.blockType, content: sec.content,
      version: 1,
    })
  }

  const s2 = (sections as Array<{ sectionNo: string; content: { rows?: unknown[] } }>).find(s => s.sectionNo === 'S2')
  const s4 = (sections as Array<{ sectionNo: string; content: { rows?: Array<{ criterion: string; threshold: string; verification: string }> } }>).find(s => s.sectionNo === 'S4')

  if (s2?.content?.rows) {
    await db.update(tenders).set({ pqCriteria: { criteria: s2.content.rows } }).where(eq(tenders.id, tenderId))
  }

  if (s4?.content?.rows) {
    await db.delete(tenderClauses).where(
      and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId), eq(tenderClauses.source, 'authored'))
    )
    const rows = s4.content.rows.map((r, i) => ({
      tenderId, tenantId,
      clauseNo: `4.${i + 1}`,
      title: r.criterion,
      content: `Threshold: ${r.threshold}; Verification: ${r.verification}`,
      category: 'technical',
      source: 'authored' as const,
    }))
    if (rows.length) await db.insert(tenderClauses).values(rows)
  }
}

function singleSectionOutputFormat(sectionNo: string, blockType: string): string {
  const base = `{"sectionNo":"${sectionNo}","title":"...","blockType":"${blockType}","content":`
  if (blockType === 'prose')
    return base + `{"text":"...","clauses":[{"clauseNo":"${sectionNo}.1","title":"...","text":"...","source":"drafted","libraryRef":null}]}}`
  if (blockType === 'criteria-table')
    return base + `{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}}`
  if (blockType === 'spec-table')
    return base + `{"rows":[{"metric":"...","target":"...","measurement":"..."}],"clauses":[]}}`
  if (blockType === 'line-item-table')
    return base + `{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}}`
  return base + `{}}`
}
