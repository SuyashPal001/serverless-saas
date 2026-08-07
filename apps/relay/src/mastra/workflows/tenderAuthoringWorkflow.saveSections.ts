import { createStep } from '@mastra/core/workflows'
import { db, tenders, tenderClauses, rfpSections } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { enforceStepOutputSchema, saveStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

interface SectionInput { sectionNo: string; title: string; blockType: string; content: object }

async function saveRfpSections(tenderId: string, tenantId: string, sections: SectionInput[]): Promise<void> {
  await db.delete(rfpSections).where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId)))

  for (const sec of sections) {
    await db.insert(rfpSections).values({
      tenderId, tenantId,
      sectionNo: sec.sectionNo, title: sec.title,
      blockType: sec.blockType, content: sec.content,
      version: 1,
    })
  }

  const s2 = sections.find((s): s is SectionInput & { content: { rows?: unknown[] } } => s.sectionNo === 'S2')
  const s4 = sections.find((s): s is SectionInput & { content: { rows?: Array<{ criterion: string; threshold: string; verification: string }> } } => s.sectionNo === 'S4')

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

export const saveSectionsStep = createStep({
  id: 'tender-authoring-save-sections',
  inputSchema: enforceStepOutputSchema,
  outputSchema: saveStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, sections, cvcFlags } = inputData

    await saveRfpSections(tenderId, tenantId, sections as SectionInput[])

    const [tender] = await db.select({ templateFields: tenders.templateFields }).from(tenders).where(eq(tenders.id, tenderId))
    const currentTf = (tender?.templateFields ?? {}) as Record<string, unknown>
    await db.update(tenders)
      .set({ authoringStatus: 'completed', templateFields: { ...currentTf, cvcFlags } })
      .where(eq(tenders.id, tenderId))

    return { tenderId, tenantId, sectionCount: sections.length }
  },
})
