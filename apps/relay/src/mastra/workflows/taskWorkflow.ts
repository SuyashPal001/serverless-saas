import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

// Import agents directly (not via index.js) to avoid circular dependency:
// taskAgent → taskWorkflow → index → taskAgent
import { taskAgent } from '../agents/taskAgent.js'
import { formatterAgent } from '../agents/formatterAgent.js'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  planData: z.string(), // JSON string: plan + milestones from fetchPlan
})

const analyzeOutputSchema = z.object({
  analysis: z.string(),
})

const generateOutputSchema = z.object({
  taskDraft: z.string(),
})

// TaskGenerationData shape — acceptance_criteria stored as string[] here;
// saveTasks.ts converts each entry to { text, checked: false } before INSERT.
const taskItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  estimatedHours: z.number().optional(),
})

const milestoneTaskDataSchema = z.object({
  milestoneId: z.string(),   // FK → project_milestones.id — must come from input, never invented
  milestoneName: z.string(), // logging only
  tasks: z.array(taskItemSchema),
})

const taskGenerationDataSchema = z.object({
  planId: z.string(),
  milestones: z.array(milestoneTaskDataSchema),
})

const formatOutputSchema = z.object({
  taskData: taskGenerationDataSchema,
})

// ─── Step 1: analyzeStep ─────────────────────────────────────────────────────
// taskAgent summarizes the scope, priority, and AC of each milestone in the
// plan. Plain text output only — no JSON, no tasks yet.

export const analyzeStep = createStep({
  id: 'analyze-milestones',
  inputSchema: workflowInputSchema,
  outputSchema: analyzeOutputSchema,
  execute: async ({ inputData }) => {
    const { planData } = inputData

    const prompt = [
      `Use the task-breakdown skill to analyze this project plan.`,
      ``,
      `For each milestone, summarize in structured plain text:`,
      `- Milestone title and ID (preserve the exact ID)`,
      `- Scope: what work is in scope for this milestone`,
      `- Priority: the milestone priority and what it implies for tasks`,
      `- Acceptance criteria: what done looks like`,
      `- Complexity estimate: simple | moderate | complex`,
      ``,
      `Do not generate tasks yet. Write in structured plain text. Do not produce JSON.`,
      ``,
      `--- Plan Data ---`,
      planData,
      `--- End Plan Data ---`,
    ].join('\n')

    let analysis = ''

    try {
      const result = await taskAgent.generate(prompt)
      analysis = result.text ?? ''
      console.log(`[analyzeStep:tasks] analysis length=${analysis.length}`)
    } catch (err) {
      console.error('[analyzeStep:tasks] error:', (err as Error).message)
      analysis = planData
    }

    return { analysis }
  },
})

// ─── Step 2: generateStep ─────────────────────────────────────────────────────
// taskAgent generates 3–7 tasks per milestone following the task-breakdown
// SKILL.md SOP. Uses getInitData() to access milestone IDs from the original
// plan. Plain text output for formatStep to parse.

export const generateStep = createStep({
  id: 'generate-tasks',
  inputSchema: analyzeOutputSchema,
  outputSchema: generateOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    const { analysis } = inputData
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()

    // Always surface all milestone IDs even if the full JSON is large.
    // Truncating planData risks cutting UUIDs — the LLM would invent them,
    // causing FK violations or orphaned rows in saveTasks.
    let milestoneRef = initData.planData.slice(0, 20000)
    try {
      const parsed = JSON.parse(initData.planData)
      const idLines = (parsed?.milestones ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => `${m.id} — ${m.title}`)
        .join('\n')
      if (idLines) {
        milestoneRef = `Plan data excerpt:\n${initData.planData.slice(0, 20000)}\n\nAll milestone IDs (never invent these):\n${idLines}`
      }
    } catch { /* use raw slice */ }

    const prompt = [
      `Use the task-breakdown skill to generate tasks for each milestone.`,
      ``,
      `Original plan data (milestone IDs must be copied exactly — do not invent IDs):`,
      milestoneRef,
      ``,
      `Milestone analysis:`,
      analysis,
      ``,
      `For each milestone generate 3–7 tasks. For each task write:`,
      `- milestoneId: the exact UUID from the plan data above`,
      `- title: action-oriented verb phrase`,
      `- description: 1–2 sentences on what to build and why`,
      `- priority: low | medium | high | urgent`,
      `- acceptanceCriteria: 2–4 plain-english done-criteria as a list`,
      `- estimatedHours: integer 1–8`,
      ``,
      `Order tasks within each milestone: foundational first, polish last.`,
      `Write in structured plain text. Do not produce JSON.`,
    ].filter(Boolean).join('\n')

    let taskDraft = ''

    try {
      const result = await taskAgent.generate(prompt)
      taskDraft = result.text ?? ''
      console.log(`[generateStep:tasks] taskDraft length=${taskDraft.length}`)
    } catch (err) {
      console.error('[generateStep:tasks] error:', (err as Error).message)
      taskDraft = analysis
    }

    return { taskDraft }
  },
})

// ─── Step 3: formatStep ───────────────────────────────────────────────────────
// formatterAgent converts the plain-text task draft into TaskGenerationData JSON.
// Two-pass pattern: formatterAgent has no tools so structuredOutput works
// without conflicting with functionDeclarations (Gemini constraint).
// milestoneId values must be real UUIDs copied from planData — never invented.
// acceptanceCriteria remains string[] here; saveTasks converts to {text,checked}[].

export const formatStep = createStep({
  id: 'format-tasks',
  inputSchema: generateOutputSchema,
  outputSchema: formatOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    const { taskDraft } = inputData
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()

    // Extract planId from the original plan data for the output root
    let planId = ''
    try {
      const parsed = JSON.parse(initData.planData)
      planId = parsed?.plan?.id ?? parsed?.id ?? ''
    } catch {
      // planId stays empty — formatterAgent will extract it from the draft
    }

    const prompt = [
      `Convert the task draft below into a structured JSON object matching the schema exactly.`,
      `milestoneId on every milestone must be a real UUID from the plan — never invent IDs.`,
      `acceptanceCriteria must be an array of plain strings (not objects).`,
      planId ? `planId must be: "${planId}"` : `Extract planId from the task draft or plan data.`,
      ``,
      `--- Task Draft ---`,
      taskDraft.slice(0, 8000),
      `--- End Draft ---`,
      ``,
      `Return:`,
      `{ "taskData": {`,
      `    "planId": "uuid",`,
      `    "milestones": [{`,
      `      "milestoneId": "uuid",`,
      `      "milestoneName": "...",`,
      `      "tasks": [{`,
      `        "title": "...",`,
      `        "description": "...",`,
      `        "acceptanceCriteria": ["...", "..."],`,
      `        "priority": "low|medium|high|urgent",`,
      `        "estimatedHours": number`,
      `      }]`,
      `    }]`,
      `  }`,
      `}`,
    ].join('\n')

    const fallback: z.infer<typeof formatOutputSchema> = {
      taskData: { planId, milestones: [] },
    }

    try {
      const result = await formatterAgent.generate(prompt, {
        structuredOutput: { schema: formatOutputSchema },
      })
      if (result.object) {
        console.log('[formatStep:tasks] structured task data produced successfully')
        return result.object as z.infer<typeof formatOutputSchema>
      }
    } catch (err) {
      console.error('[formatStep:tasks] error:', (err as Error).message)
    }

    return fallback
  },
})

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const taskWorkflow = createWorkflow({
  id: 'task-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: formatOutputSchema,
})
  .then(analyzeStep)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(generateStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(formatStep as any)
  .commit()
