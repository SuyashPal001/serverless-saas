import { createWorkflow } from '@mastra/core/workflows'
import { authoringInputSchema, saveStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'
import { computeClauseRulesStep } from './tenderAuthoringWorkflow.computeClauseRules.js'
import { draftSectionsStep } from './tenderAuthoringWorkflow.draftSections.js'
import { enforceMandatoryClausesStep } from './tenderAuthoringWorkflow.enforceMandatoryClauses.js'
import { saveSectionsStep } from './tenderAuthoringWorkflow.saveSections.js'

export const tenderAuthoringWorkflow = createWorkflow({
  id: 'tender-authoring',
  inputSchema: authoringInputSchema,
  outputSchema: saveStepOutputSchema,
})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(computeClauseRulesStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(draftSectionsStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(enforceMandatoryClausesStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(saveSectionsStep as any)
  .commit()
