import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

// Import agents directly (not via index.js) to avoid circular dependency:
// prdAgent → prdWorkflow → index → prdAgent
import { prdAgent } from '../agents/prdAgent.js'
import { formatterAgent } from '../agents/formatterAgent.js'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  userMessage: z.string(),
  conversationHistory: z.string().optional().default(''),
})

const gatherOutputSchema = z.object({
  requirements: z.string(),
  clarifications: z.array(z.string()),
})

const writeOutputSchema = z.object({
  prdText: z.string(),
})

// Structured PRD shape — matches the prd-writing SKILL.md section headings.
const prdSchema = z.object({
  tldr: z.string(),
  problemStatement: z.string(),
  goals: z.array(z.string()),
  nonGoals: z.array(z.string()),
  userStories: z.array(z.object({
    story: z.string(),
    acceptanceCriteria: z.array(z.string()),
  })),
  functionalRequirements: z.array(z.string()),
  successMetrics: z.array(z.object({
    name: z.string(),
    target: z.string(),
    measurement: z.string(),
  })),
  openQuestions: z.array(z.string()),
})

const formatOutputSchema = z.object({
  prd: prdSchema,
})

// ─── Step 1: gatherStep ───────────────────────────────────────────────────────
// prdAgent uses the requirements-gathering skill (injected via prdWorkspace).
// Returns full requirements text + extracted clarification questions.

export const gatherStep = createStep({
  id: 'gather-requirements',
  inputSchema: workflowInputSchema,
  outputSchema: gatherOutputSchema,
  execute: async ({ inputData }) => {
    const { userMessage, conversationHistory } = inputData

    const prompt = [
      `Use the requirements-gathering skill to analyze this request.`,
      ``,
      `User request: ${userMessage}`,
      conversationHistory
        ? `Conversation history:\n${conversationHistory}`
        : null,
      ``,
      `Identify stakeholders, extract functional and non-functional requirements,`,
      `and list any clarifying questions that must be answered before writing the PRD.`,
      `Write in structured plain text. Do not produce JSON.`,
    ].filter(Boolean).join('\n')

    let requirements = ''
    let clarifications: string[] = []

    try {
      const result = await prdAgent.generate(prompt)
      requirements = result.text ?? ''

      // Extract question lines as clarifications — prdAgent writes plain text,
      // so questions are lines ending with '?'
      clarifications = requirements
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.endsWith('?') && l.length > 5)

      console.log(`[gatherStep] requirements length=${requirements.length} clarifications=${clarifications.length}`)
    } catch (err) {
      console.error('[gatherStep] error:', (err as Error).message)
      requirements = userMessage
    }

    return { requirements, clarifications }
  },
})

// ─── Step 2: writeStep ────────────────────────────────────────────────────────
// prdAgent uses the prd-writing skill to produce a full PRD in structured
// plain text, given the gathered requirements.

export const writeStep = createStep({
  id: 'write-prd',
  inputSchema: gatherOutputSchema,
  outputSchema: writeOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    const { requirements, clarifications } = inputData
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()

    const prompt = [
      `Use the prd-writing skill to write a complete PRD.`,
      ``,
      `Original request: ${initData.userMessage}`,
      ``,
      `Gathered requirements:`,
      requirements,
      clarifications.length > 0
        ? `\nKey clarifications to address:\n${clarifications.map(q => `- ${q}`).join('\n')}`
        : null,
      ``,
      `Follow the full PRD structure from the skill: TL;DR, Problem Statement,`,
      `Goals, Non-Goals, User Stories (with acceptance criteria), Functional Requirements,`,
      `Non-Functional Requirements, Success Metrics, Open Questions.`,
      `Write in structured plain text. Do not produce JSON.`,
      `IMPORTANT: Output ONLY the PRD document itself.`,
      `Do NOT include skill instructions, guidelines, metadata, or any text that`,
      `is not part of the PRD. Start directly with "## TL;DR" and end with the`,
      `Open Questions section. Nothing before or after.`,
    ].filter(Boolean).join('\n')

    let prdText = ''

    try {
      const result = await prdAgent.generate(prompt)
      prdText = result.text ?? ''
      console.log(`[writeStep] prdText length=${prdText.length}`)
    } catch (err) {
      console.error('[writeStep] error:', (err as Error).message)
      prdText = `PRD generation failed: ${(err as Error).message}`
    }

    return { prdText }
  },
})

// ─── Step 3: formatStep ───────────────────────────────────────────────────────
// formatterAgent converts the plain-text PRD into structured JSON.
// Two-pass pattern: formatterAgent has no tools so structuredOutput works
// without conflicting with functionDeclarations (Gemini constraint).

export const formatStep = createStep({
  id: 'format-prd',
  inputSchema: writeOutputSchema,
  outputSchema: formatOutputSchema,
  execute: async ({ inputData }) => {
    const { prdText } = inputData

    const prompt = [
      `Convert the PRD below into a structured JSON object matching the schema exactly.`,
      ``,
      `--- PRD ---`,
      prdText.slice(0, 25000),
      `--- End PRD ---`,
      ``,
      `Return: { "prd": { "tldr": "...", "problemStatement": "...", "goals": [...],`,
      `  "nonGoals": [...], "userStories": [{ "story": "...", "acceptanceCriteria": [...] }],`,
      `  "functionalRequirements": [...], "successMetrics": [{ "name": "...", "target": "...", "measurement": "..." }],`,
      `  "openQuestions": [...] } }`,
    ].join('\n')

    try {
      const result = await formatterAgent.generate(prompt, {
        structuredOutput: { schema: formatOutputSchema },
      })
      if (result.object) {
        console.log('[formatStep] structured PRD produced successfully')
        return result.object as z.infer<typeof formatOutputSchema>
      }
    } catch (err) {
      console.error('[formatStep] error:', (err as Error).message)
    }

    // Fallback: wrap raw text so the workflow output shape is always valid
    return {
      prd: {
        tldr: '',
        problemStatement: prdText.slice(0, 500),
        goals: [],
        nonGoals: [],
        userStories: [],
        functionalRequirements: [],
        successMetrics: [],
        openQuestions: [],
      },
    }
  },
})

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const prdWorkflow = createWorkflow({
  id: 'prd-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: formatOutputSchema,
})
  .then(gatherStep)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(writeStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(formatStep as any)
  .commit()
