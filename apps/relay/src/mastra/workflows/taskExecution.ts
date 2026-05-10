import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

import { platformAgent, formatterAgent } from '../index.js'


// ─── Shared schemas ───────────────────────────────────────────────────────────

const jobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  salary: z.string().optional(),
  applyUrl: z.string().optional(),
})

// ─── Workflow input ───────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  taskTitle: z.string(),
  taskDescription: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  tenantId: z.string(),
  attachmentContext: z.string().optional(),
  referenceText: z.string().optional(),
  links: z.array(z.string()).optional(),
  autoApprove: z.boolean().optional().default(true),
})

// ─── Step schemas ─────────────────────────────────────────────────────────────

// planStep must return an array directly — .foreach() requires TPrevSchema extends any[]
const planOutputSchema = z.array(z.object({ query: z.string() }))

const searchOutputSchema = z.object({
  jobs: z.array(jobSchema),
  status: z.enum(['done', 'failed']),
})

const mergeOutputSchema = z.object({
  jobs: z.array(jobSchema),
  totalFound: z.number(),
})

const composeOutputSchema = z.object({
  summary: z.string(),
  status: z.enum(['done', 'needs_clarification', 'failed']),
  reasoning: z.string().optional(),
})

// ─── Step 1: planStep ────────────────────────────────────────────────────────
// Breaks the task into 2–4 specific search queries.
// outputSchema is a plain array so .foreach() can iterate it.

export const planStep = createStep({
  id: 'plan',
  inputSchema: workflowInputSchema,
  outputSchema: planOutputSchema,
  execute: async ({ inputData }) => {
    const initData = inputData
    const { taskTitle, taskDescription, acceptanceCriteria, attachmentContext, referenceText, links } = initData

    const prompt = [
      `Break this task into 2–4 specific search queries that together would fully answer it.`,
      `Return ONLY a JSON object: { "queries": ["query1", "query2", ...], "approach": "one sentence" }`,
      ``,
      `Task: ${taskTitle}`,
      taskDescription ? `Description: ${taskDescription}` : null,
      acceptanceCriteria ? `Definition of Done: ${acceptanceCriteria}` : null,
      attachmentContext ? `\n## Attached Files\n${attachmentContext}` : null,
      referenceText ? `\n## Reference Material\n${referenceText}` : null,
      links?.length ? `\n## Relevant Links\n${links.join('\n')}` : null,
    ].filter(Boolean).join('\n')

    let queries: string[] = []
    let approach = ''

    try {
      const result = await platformAgent.generate(prompt, {
        activeTools: [],
      })
      const text = result.text ?? ''
      // Extract JSON block — model may wrap in ```json ... ```
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { queries?: string[]; approach?: string }
        queries = Array.isArray(parsed.queries) ? parsed.queries.filter(q => typeof q === 'string') : []
        approach = typeof parsed.approach === 'string' ? parsed.approach : ''
      }
    } catch (err) {
      console.error('[planStep] error:', (err as Error).message)
    }

    if (queries.length === 0) {
      // Fallback: use taskTitle as single query
      queries = [taskTitle]
    }

    console.log(`[planStep] approach: ${approach}`)
    console.log(`[planStep] queries (${queries.length}):`, queries)

    return queries.map(q => ({ query: q }))
  },
})

// ─── Step 2: searchStep ──────────────────────────────────────────────────────
// Runs once per query via .foreach(). Two-pass to avoid Gemini conflict:
// Pass 1 — tool call (internet_search), no structuredOutput → free text
// Pass 2 — formatterAgent with structuredOutput, no tools → jobs array

export const searchStep = createStep({
  id: 'search',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: searchOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    const { query } = inputData
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()
    const { taskTitle } = initData

    const pass1Prompt = [
      `Task: ${taskTitle}`,
      `Search query: ${query}`,
      ``,
      `Use internet_search to find job listings matching this query.`,
      `For each listing found, extract: job title, company, location, salary (if shown), apply URL.`,
      `Present all results clearly.`,
    ].join('\n')

    let pass1Text = ''
    try {
      const pass1 = await platformAgent.generate(pass1Prompt, {
        activeTools: ['internet_search'],
      })
      pass1Text = pass1.text ?? ''
      console.log(`[searchStep] query="${query}" pass1 length=${pass1Text.length}`)
    } catch (err) {
      console.error(`[searchStep] pass1 error for query="${query}":`, (err as Error).message)
      return { jobs: [], status: 'failed' as const }
    }

    // Pass 2 — extract structured jobs from pass1 text
    const pass2Prompt = [
      `Extract all job listings from the text below into a JSON array.`,
      ``,
      `--- Search results ---`,
      pass1Text.slice(0, 4000),
      `--- End ---`,
      ``,
      `Return: { "jobs": [...], "status": "done" | "failed" }`,
      `Each job: title (string), company (string), location (string), salary? (string), applyUrl? (string)`,
      `If no jobs found, return jobs: [].`,
    ].join('\n')

    try {
      const pass2 = await formatterAgent.generate(pass2Prompt, {
        structuredOutput: { schema: searchOutputSchema },
      })
      if (pass2.object) {
        const result = pass2.object as z.infer<typeof searchOutputSchema>
        console.log(`[searchStep] query="${query}" jobs found: ${result.jobs.length}`)
        return result
      }
    } catch (err) {
      console.error(`[searchStep] pass2 error for query="${query}":`, (err as Error).message)
    }

    return { jobs: [], status: 'done' as const }
  },
})

// ─── Step 3: mergeStep ────────────────────────────────────────────────────────
// After .foreach(), inputData is searchOutputSchema[] — all search results as array.
// Combines and deduplicates all jobs.

export const mergeStep = createStep({
  id: 'merge-results',
  inputSchema: z.array(searchOutputSchema),
  outputSchema: mergeOutputSchema,
  execute: async ({ inputData }) => {
    const results = inputData as Array<z.infer<typeof searchOutputSchema>>
    console.log('[mergeStep] received results count:', Array.isArray(results) ? results.length : 'not-array')

    const allJobs = Array.isArray(results)
      ? results.filter(r => r?.status === 'done').flatMap(r => r?.jobs ?? [])
      : []

    // Deduplicate by applyUrl if present, otherwise company::title
    const seen = new Set<string>()
    const deduped = allJobs.filter(j => {
      const key = j.applyUrl
        ? j.applyUrl.toLowerCase()
        : `${j.company}::${j.title}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    console.log(`[mergeStep] total after dedup: ${deduped.length} (from ${allJobs.length} raw)`)

    return { jobs: deduped, totalFound: deduped.length }
  },
})

// ─── Step 4: composeStep ──────────────────────────────────────────────────────
// Formats merged jobs into clean readable output. No tools.

export const composeStep = createStep({
  id: 'compose-output',
  inputSchema: z.object({}),
  outputSchema: composeOutputSchema,
  execute: async ({ getInitData, getStepResult }) => {
    const initData = getInitData<z.infer<typeof workflowInputSchema>>()
    const { taskTitle, acceptanceCriteria } = initData

    const mergeResult = getStepResult(mergeStep)
    console.log('[composeStep] mergeResult:', JSON.stringify(mergeResult))

    const jobs = mergeResult?.jobs ?? []
    const jobsText = jobs.length > 0
      ? JSON.stringify(jobs)
      : '(no job listings found)'

    const prompt = [
      `Task: ${taskTitle}`,
      acceptanceCriteria ? `\nDefinition of done:\n${acceptanceCriteria}` : null,
      ``,
      `Here are the job listings found:`,
      `---`,
      jobsText,
      `---`,
      ``,
      `Format this into a clean, readable list for the user.`,
      `- Present each job as a clear entry with title, company, location, salary (if available), apply URL (if available)`,
      `- Do not include raw JSON or technical artifacts`,
      `- If apply URLs are missing, note that`,
      `- Write the complete formatted list in the summary field. Do not write an intro line and stop. Include every job with all available fields. The summary IS the final output the user reads.`,
    ].filter(Boolean).join('\n')

    try {
      const result = await platformAgent.generate(prompt, {
        activeTools: [],
        structuredOutput: { schema: composeOutputSchema },
      })
      if (result.object) {
        return result.object as z.infer<typeof composeOutputSchema>
      }
      return {
        summary: result.text ?? '(no output)',
        status: 'done' as const,
        reasoning: undefined,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        summary: `Compose failed: ${message}`,
        status: 'failed' as const,
        reasoning: message,
      }
    }
  },
})

// ─── Step 2a: approvalStep ────────────────────────────────────────────────────
// Optional human-in-the-loop gate between plan and search.
// When autoApprove is true (default), skips suspension immediately.
// When autoApprove is false, suspends until resume() is called externally.

export const approvalStep = createStep({
  id: 'approval',
  // Pass-through: receives planStep's query array, returns it unchanged.
  // Same schema on both sides preserves the array type so .foreach() works without as any.
  inputSchema: planOutputSchema,
  outputSchema: planOutputSchema,
  execute: async ({ inputData, getInitData, ...ctx }) => {
    const initData = getInitData() as z.infer<typeof workflowInputSchema>
    // suspend is injected by Mastra at runtime but not in the public TS types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suspend = (ctx as any).suspend as ((payload: unknown) => Promise<void>) | undefined

    if (initData.autoApprove !== false) {
      return inputData
    }

    // Suspend — execution pauses here until workflow.resume(runId, payload) is called
    if (suspend) {
      await suspend({
        message: 'Please review the search plan and approve to continue',
        queries: initData.taskTitle,
      })
    }

    return inputData
  },
})

// ─── Workflow ─────────────────────────────────────────────────────────────────
// planStep returns z.array(z.object({ query })) which satisfies .foreach()'s
// TPrevSchema extends any[] constraint — no as any needed on foreach.
// mergeStep and composeStep use z.object({}) inputSchema → as any required.

export const taskExecutionWorkflow = createWorkflow({
  id: 'task-execution',
  inputSchema: workflowInputSchema,
  outputSchema: composeOutputSchema,
})
  .then(planStep)
  .then(approvalStep)
  .foreach(searchStep, { concurrency: 3 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(mergeStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(composeStep as any)
  .commit()
