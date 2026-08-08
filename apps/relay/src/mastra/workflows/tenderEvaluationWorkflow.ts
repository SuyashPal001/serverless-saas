import { createWorkflow } from '@mastra/core/workflows'
import { tenderInputSchema, reportStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'
import { pqEvaluateStep } from './tenderEvaluationWorkflow.pqEvaluate.js'
import { technicalEvaluateStep } from './tenderEvaluationWorkflow.technicalEvaluate.js'
import { shortfallDetectStep } from './tenderEvaluationWorkflow.shortfallDetect.js'
import { financialEvaluateStep } from './tenderEvaluationWorkflow.financialEvaluate.js'
import { reportAssembleStep } from './tenderEvaluationWorkflow.reportAssemble.js'

export const tenderEvaluationWorkflow = createWorkflow({
  id: 'tender-evaluation',
  inputSchema: tenderInputSchema,
  outputSchema: reportStepOutputSchema,
})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(pqEvaluateStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(technicalEvaluateStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(shortfallDetectStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(financialEvaluateStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(reportAssembleStep as any)
  .commit()
