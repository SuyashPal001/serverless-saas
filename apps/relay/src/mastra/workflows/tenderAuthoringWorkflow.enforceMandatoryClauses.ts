import { createStep } from '@mastra/core/workflows'
import { db, clauseLibrary } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { enforceRequiredClauses } from '../rules/tenderClauseRules.js'
import { draftStepOutputSchema, enforceStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

export const enforceMandatoryClausesStep = createStep({
  id: 'tender-authoring-enforce-mandatory-clauses',
  inputSchema: draftStepOutputSchema,
  outputSchema: enforceStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, mandatory, annexures, sections, cvcFlags } = inputData

    const libraryRows = await db.select().from(clauseLibrary)
      .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))

    const patchedSections = enforceRequiredClauses(
      sections as Array<{ sectionNo: string; title: string; blockType: string; content: Record<string, unknown> }>,
      mandatory,
      libraryRows
    )

    return { tenderId, tenantId, mandatory, annexures, sections: patchedSections, cvcFlags }
  },
})
