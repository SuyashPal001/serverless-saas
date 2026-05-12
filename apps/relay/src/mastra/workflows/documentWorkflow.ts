import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

import { prdAgent, formatterAgent } from '../index.js'

// ─── Workflow input ───────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  taskTitle: z.string(),
  taskDescription: z.string().optional(),
  attachmentContext: z.string(),
  tenantId: z.string(),
  autoApprove: z.boolean().optional(),
})

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  estimatedHours: z.number().optional(),
  type: z.enum(['feature', 'bug', 'chore', 'spike']).default('feature'),
})

const milestoneSchema = z.object({
  title: z.string(),
  description: z.string(),
  targetDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  tasks: z.array(taskSchema),
})

// Core PRD extraction shape — reused as structuredOutput target and docDodVerify passthrough.
const prdDataSchema = z.object({
  plan: z.object({
    title: z.string(),
    description: z.string(),
    targetDate: z.string().optional(),
  }),
  milestones: z.array(milestoneSchema),
  risks: z.array(z.string()),
  totalEstimatedHours: z.number().optional(),
})

// ─── Step output schemas ──────────────────────────────────────────────────────

const planOutputSchema = z.object({
  plan: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
})

// extractStep output = prdData fields + token accumulators
const extractOutputSchema = prdDataSchema.extend({
  inputTokens: z.number(),
  outputTokens: z.number(),
})

// docDodVerifyStep output = DoD result + prdData passthrough + token accumulators
const docDodVerifyOutputSchema = z.object({
  passed: z.boolean(),
  failureReason: z.string().optional(),
  criteriaMet: z.array(z.string()),
  criteriaUnmet: z.array(z.string()),
  prdData: prdDataSchema,
  inputTokens: z.number(),
  outputTokens: z.number(),
})

// composeStep output — also used for structuredOutput call.
// inputTokens/outputTokens are optional so formatterAgent can leave them null;
// we always override with exact values before returning.
const composeOutputSchema = z.object({
  summary: z.string(),
  dodPassed: z.boolean(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
})

// ─── Step 1: planStep ─────────────────────────────────────────────────────────
// Reads the PRD and produces a milestone plan in plain text.
// prdAgent, no tools, free-text output.

const planStep = createStep({
  id: 'doc-plan',
  inputSchema: workflowInputSchema,
  outputSchema: planOutputSchema,
  execute: async ({ inputData }) => {
    const { taskTitle, attachmentContext } = inputData

    const prompt = [
      `You are a senior engineering lead. Read this PRD and produce a milestone plan in plain text.`,
      ``,
      `Rules:`,
      `- Produce 2-5 milestones ordered by dependency`,
      `- Each milestone: phase number + name + one sentence outcome + list of PRD features that belong to it`,
      `- Mark any features explicitly deferred as post-launch/Phase 2 as OUT OF SCOPE — do not include in milestones`,
      `- Flag ambiguous requirements explicitly`,
      `- Do NOT produce tasks yet — milestones only`,
      ``,
      `PRD Title: ${taskTitle}`,
      `PRD Content: ${attachmentContext}`,
    ].join('\n')

    try {
      const result = await prdAgent.generate(prompt, { activeTools: [] })
      console.log(`[doc:planStep] plan length=${result.text?.length ?? 0}`)
      return {
        plan: result.text ?? '',
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      }
    } catch (err) {
      console.error('[doc:planStep] error:', (err as Error).message)
      return { plan: '', inputTokens: 0, outputTokens: 0 }
    }
  },
})

// ─── Step 2: extractStep ──────────────────────────────────────────────────────
// Two-pass to avoid Gemini responseSchema + functionDeclarations conflict:
// Pass 1 — prdAgent, no tools, free-text breakdown
// Pass 2 — formatterAgent, structuredOutput (prdDataSchema), no tools

const extractStep = createStep({
  id: 'doc-extract',
  inputSchema: planOutputSchema,
  outputSchema: extractOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    const { plan, inputTokens: planInputTokens, outputTokens: planOutputTokens } = inputData
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()
    const { taskTitle, attachmentContext } = initData

    const emptyFallback: z.infer<typeof extractOutputSchema> = {
      plan: { title: taskTitle, description: '' },
      milestones: [],
      risks: [],
      inputTokens: planInputTokens,
      outputTokens: planOutputTokens,
    }

    const pass1Prompt = [
      `CRITICAL: You MUST produce tasks for ALL milestones listed in the plan above. Do not stop after the first milestone. The output is incomplete unless every milestone has 3-8 tasks. Count the milestones in the plan and ensure your output covers every single one.`,
      ``,
      `You are a senior engineering lead.`,
      `You have already planned these milestones:`,
      plan,
      ``,
      `Now extract the full task breakdown for each milestone.`,
      ``,
      `For every milestone produce 3-8 tasks. Each task must have:`,
      `- Title (action verb + noun)`,
      `- Description (what needs to be built)`,
      `- Acceptance criteria (3-5 testable conditions)`,
      `- Estimate in hours: XS=2 S=4 M=8 L=16 XL=32`,
      `- Type: feature | bug | chore | spike`,
      `- Priority: low | medium | high | urgent`,
      ``,
      `Rules:`,
      `- Every PRD feature maps to at least one task`,
      `- Ambiguous requirements → spike task`,
      `- Post-launch features stay OUT of milestones`,
      `- Estimates must be specific numbers, never TBD`,
      ``,
      `PRD Content: ${attachmentContext}`,
    ].join('\n')

    let pass1Text = ''
    let pass1InputTokens = 0
    let pass1OutputTokens = 0
    try {
      const pass1 = await prdAgent.generate(pass1Prompt, { activeTools: [], modelSettings: { maxOutputTokens: 24000 } })
      pass1Text = pass1.text ?? ''
      pass1InputTokens = pass1.usage?.inputTokens ?? 0
      pass1OutputTokens = pass1.usage?.outputTokens ?? 0
      console.log(`[doc:extractStep] pass1 length=${pass1Text.length}`)
    } catch (err) {
      console.error('[doc:extractStep] pass1 error:', (err as Error).message)
      return emptyFallback
    }

    const pass2Prompt = [
      `CRITICAL: Extract ALL milestones from the input. The input contains multiple milestones. Do not stop after extracting the first one. Your output is incomplete if milestones array has fewer items than the input describes.`,
      ``,
      `Extract the project plan and milestone/task breakdown from the text below into structured JSON.`,
      ``,
      `--- Breakdown text ---`,
      pass1Text.slice(0, 24000),
      `--- End ---`,
      ``,
      `Instructions:`,
      `- plan.title: use "${taskTitle}"`,
      `- plan.description: 1-2 sentence summary of what this PRD delivers`,
      `- milestones: each milestone from the breakdown, with all tasks`,
      `- tasks: every task under its milestone, with all fields populated`,
      `- risks: 2-5 top project risks as short strings`,
      `- totalEstimatedHours: sum of all task estimatedHours`,
    ].join('\n')

    try {
      const pass2 = await formatterAgent.generate(pass2Prompt, {
        structuredOutput: { schema: prdDataSchema },
        modelSettings: { maxOutputTokens: 24000 },
      })
      console.log('[doc:extractStep] pass2.object:', pass2.object ? 'populated' : 'null')
      const pass2InputTokens = pass2.usage?.inputTokens ?? 0
      const pass2OutputTokens = pass2.usage?.outputTokens ?? 0
      if (pass2.object) {
        const extracted = pass2.object as z.infer<typeof prdDataSchema>
        return {
          ...extracted,
          inputTokens: planInputTokens + pass1InputTokens + pass2InputTokens,
          outputTokens: planOutputTokens + pass1OutputTokens + pass2OutputTokens,
        }
      }
    } catch (err) {
      console.error('[doc:extractStep] pass2 error:', (err as Error).message)
    }

    return {
      ...emptyFallback,
      inputTokens: planInputTokens + pass1InputTokens,
      outputTokens: planOutputTokens + pass1OutputTokens,
    }
  },
})

// ─── Step 3: docDodVerifyStep ─────────────────────────────────────────────────
// Deterministic structural gate — no LLM call.
// Check 1: milestones.length >= 1
// Check 2: every milestone has tasks.length >= 1
// Check 3: every task has acceptanceCriteria.length >= 1
// Never crashes the workflow — errors fall back to passed: true.

const docDodVerifyStep = createStep({
  id: 'doc-dod-verify',
  inputSchema: extractOutputSchema,
  outputSchema: docDodVerifyOutputSchema,
  execute: async ({ inputData }) => {
    const { inputTokens, outputTokens, ...prdData } = inputData

    console.log(`[doc:dodVerifyStep] milestones=${prdData.milestones.length}`)

    try {
      const criteriaMet: string[] = []
      const criteriaUnmet: string[] = []

      // Check 1 — at least one milestone
      if (prdData.milestones.length >= 1) {
        criteriaMet.push('At least one milestone produced')
      } else {
        criteriaUnmet.push('No milestones produced')
      }

      // Check 2 — every milestone has at least one task
      const milestonesWithoutTasks = prdData.milestones.filter(m => m.tasks.length < 1)
      if (milestonesWithoutTasks.length === 0 && prdData.milestones.length > 0) {
        criteriaMet.push('All milestones have at least one task')
      } else if (milestonesWithoutTasks.length > 0) {
        criteriaUnmet.push(
          `Milestones missing tasks: ${milestonesWithoutTasks.map(m => m.title).join(', ')}`
        )
      }

      // Check 3 — every task has at least one acceptance criterion
      const tasksWithoutAC = prdData.milestones.flatMap(m =>
        m.tasks.filter(t => t.acceptanceCriteria.length < 1).map(t => t.title)
      )
      if (tasksWithoutAC.length === 0 && prdData.milestones.length > 0) {
        criteriaMet.push('All tasks have acceptance criteria')
      } else if (tasksWithoutAC.length > 0) {
        const sample = tasksWithoutAC.slice(0, 3).join(', ')
        const overflow = tasksWithoutAC.length > 3 ? ` (+${tasksWithoutAC.length - 3} more)` : ''
        criteriaUnmet.push(`Tasks missing acceptance criteria: ${sample}${overflow}`)
      }

      const passed = criteriaUnmet.length === 0
      const failureReason = passed ? undefined : criteriaUnmet.join('; ')

      console.log(
        `[doc:dodVerifyStep] passed=${passed} met=${criteriaMet.length} unmet=${criteriaUnmet.length}`
      )

      return {
        passed,
        failureReason,
        criteriaMet,
        criteriaUnmet,
        prdData: prdData as z.infer<typeof prdDataSchema>,
        inputTokens,
        outputTokens,
      }
    } catch (err) {
      console.error('[doc:dodVerifyStep] error — falling back to pass:', (err as Error).message)
      return {
        passed: true,
        criteriaMet: [],
        criteriaUnmet: [],
        prdData: prdData as z.infer<typeof prdDataSchema>,
        inputTokens,
        outputTokens,
      }
    }
  },
})

// ─── Step 4: docComposeStep ───────────────────────────────────────────────────
// Formats extraction + DoD result into a human-readable markdown summary.
// formatterAgent, structuredOutput, no tools.
// dodPassed is always overridden from inputData.passed — never trusted from LLM.

const docComposeStep = createStep({
  id: 'doc-compose',
  inputSchema: docDodVerifyOutputSchema,
  outputSchema: composeOutputSchema,
  execute: async ({ inputData }) => {
    const {
      passed,
      criteriaMet,
      criteriaUnmet,
      failureReason,
      prdData,
      inputTokens: prevInputTokens,
      outputTokens: prevOutputTokens,
    } = inputData
    const { plan, milestones, risks, totalEstimatedHours } = prdData

    console.log(`[doc:composeStep] dodPassed=${passed} milestones=${milestones.length}`)

    const dodStatusNote = passed
      ? `✓ All structural checks passed${criteriaMet.length > 0 ? ': ' + criteriaMet.join('; ') : ''}`
      : `⚠ ${failureReason ?? 'Structural checks failed'}${criteriaUnmet.length > 0 ? ' — ' + criteriaUnmet.join('; ') : ''}`

    const milestoneSummary = milestones
      .map((m, i) => {
        const totalHours = m.tasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0)
        return `Phase ${i + 1}: ${m.title} (${m.tasks.length} tasks, ${totalHours}h)\n${m.description}`
      })
      .join('\n\n')

    const prompt = [
      `Format this project plan into a clean markdown summary for a product team.`,
      ``,
      `Plan Title: ${plan.title}`,
      `Plan Description: ${plan.description}`,
      ``,
      `DoD Status: ${dodStatusNote}`,
      ``,
      `Milestones:`,
      milestoneSummary || '(none)',
      ``,
      risks.length > 0 ? `Risks:\n${risks.map(r => `- ${r}`).join('\n')}` : null,
      totalEstimatedHours ? `Total estimated effort: ${totalEstimatedHours}h` : null,
      ``,
      `Write a clear markdown summary. Include:`,
      `- A brief intro (1-2 sentences)`,
      `- Each milestone as a section with task count and hour estimate`,
      `- Risks listed`,
      `- DoD status at the end`,
      `Put the complete markdown in the summary field.`,
    ].filter(Boolean).join('\n')

    try {
      const result = await formatterAgent.generate(prompt, {
        structuredOutput: { schema: composeOutputSchema },
      })
      const composeInputTokens = result.usage?.inputTokens ?? 0
      const composeOutputTokens = result.usage?.outputTokens ?? 0
      if (result.object) {
        const obj = result.object as z.infer<typeof composeOutputSchema>
        return {
          ...obj,
          dodPassed: passed,
          inputTokens: prevInputTokens + composeInputTokens,
          outputTokens: prevOutputTokens + composeOutputTokens,
        }
      }
      return {
        summary: result.text ?? '(no output)',
        dodPassed: passed,
        inputTokens: prevInputTokens + composeInputTokens,
        outputTokens: prevOutputTokens + composeOutputTokens,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        summary: `Compose failed: ${message}`,
        dodPassed: passed,
        inputTokens: prevInputTokens,
        outputTokens: prevOutputTokens,
      }
    }
  },
})

// ─── Workflow ─────────────────────────────────────────────────────────────────
// planStep output type is compatible with extractStep inputSchema.
// Subsequent steps use `as any` due to Mastra's .then() type-narrowing limits —
// same pattern as taskExecution.ts.

export const documentWorkflow = createWorkflow({
  id: 'document-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: composeOutputSchema,
})
  .then(planStep)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(extractStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(docDodVerifyStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(docComposeStep as any)
  .commit()
