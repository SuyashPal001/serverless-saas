import { Hono } from 'hono'
import { db, tenders, tenderClauses, clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { tenderAuthorAgent } from '../mastra/agents/tenderAuthorAgent.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''
const GATEWAY_URL = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001') + '/v1/chat/completions'
const CLOUD_MODEL = process.env.MASTRA_CLOUD_MODEL ?? 'gemini-2.5-flash'

// Used only for single-section regeneration (different task from full authoring)
async function generateJsonFromGateway(systemInstruction: string, userPrompt: string): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer placeholder' },
    body: JSON.stringify({
      model: CLOUD_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

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
    // Extract outermost JSON object — model may emit trailing commentary after the closing brace
    const jsonStart = agentText.indexOf('{')
    const jsonEnd = agentText.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Agent returned no JSON object')
    const rawParsed = JSON.parse(agentText.slice(jsonStart, jsonEnd + 1))
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

  const systemInstruction = `You are a government procurement specialist. Return ONLY valid JSON for a single RFP section object matching exactly: {"sectionNo":"...","title":"...","blockType":"...","content":{...}}`
  const userPrompt = `Redraft this RFP section.
Tender: ${tender.title} | Dept: ${tender.department} | Category: ${templateFields.category ?? 'IT/Software'}
Section: ${section.sectionNo} - ${section.title} (blockType: ${section.blockType})
${steer ? `Officer steer: ${steer}` : ''}
Clause library:\n${libraryText}`

  try {
    const raw = await generateJsonFromGateway(systemInstruction, userPrompt)
    const parsed = JSON.parse(raw)
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
{"sections":[{"sectionNo":"S1","title":"Notice Inviting Tender","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"1.1","title":"...","text":"...","source":"drafted","libraryRef":null,"cvcFlag":null}]}},{"sectionNo":"S2","title":"Eligibility and Pre-Qualification Criteria","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null,"cvcFlag":null}],"clauses":[]}},{"sectionNo":"S3","title":"Scope of Work","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S4","title":"Technical Specifications and SLAs","blockType":"spec-table","content":{"rows":[{"metric":"...","target":"...","measurement":"...","source":"drafted","libraryRef":null,"cvcFlag":null}],"clauses":[]}},{"sectionNo":"S5","title":"Bill of Quantities","blockType":"line-item-table","content":{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}},{"sectionNo":"S6","title":"Evaluation Methodology","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S7","title":"Contract Terms","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"7.1","title":"...","text":"...","source":"library","libraryRef":"CL-013","cvcFlag":null}]}},{"sectionNo":"S8","title":"Compliance and Security","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null,"cvcFlag":null}],"clauses":[]}}]}`
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
  const s4 = (sections as Array<{ sectionNo: string; content: { rows?: Array<{ metric: string; target: string; measurement: string }> } }>).find(s => s.sectionNo === 'S4')

  if (s2?.content?.rows) {
    await db.update(tenders).set({ pqCriteria: { criteria: s2.content.rows } }).where(eq(tenders.id, tenderId))
  }

  if (s4?.content?.rows) {
    await db.delete(tenderClauses).where(and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId)))
    const rows = s4.content.rows.map((r, i) => ({
      tenderId, tenantId,
      clauseNo: `4.${i + 1}`,
      title: r.metric,
      content: `Target: ${r.target}; Measurement: ${r.measurement}`,
      category: 'technical',
    }))
    if (rows.length) await db.insert(tenderClauses).values(rows)
  }
}
