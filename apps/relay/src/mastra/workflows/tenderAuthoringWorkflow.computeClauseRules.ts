import { createStep } from '@mastra/core/workflows'
import { db, tenders } from '@serverless-saas/database'
import { eq } from 'drizzle-orm'
import { computeApplicableClauses } from '../rules/tenderClauseRules.js'
import { authoringInputSchema, clauseRulesStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

export const computeClauseRulesStep = createStep({
  id: 'tender-authoring-compute-clause-rules',
  inputSchema: authoringInputSchema,
  outputSchema: clauseRulesStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId } = inputData

    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    if (!tender) throw new Error(`tender not found: ${tenderId}`)

    const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
    const { mandatory, annexures } = computeApplicableClauses({ budget: tender.budget }, templateFields)

    return { tenderId, tenantId, mandatory, annexures }
  },
})
