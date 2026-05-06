import { Workflow, Step } from '@mastra/core/workflows'
import { z } from 'zod'
import { createTenantAgent, TenantAgentConfig } from
  './agent.js'

// Task step schema — matches our existing taskSteps table
const StepInputSchema = z.object({
  stepId: z.string(),
  stepNumber: z.number(),
  title: z.string(),
  description: z.string().optional(),
  toolName: z.string().optional(),
})

const StepOutputSchema = z.object({
  stepId: z.string(),
  status: z.enum(['done', 'needs_clarification',
                  'failed']),
  summary: z.string(),
  reasoning: z.string().optional(),
  question: z.string().optional(),
  toolCalled: z.string().optional(),
  toolResult: z.unknown().optional(),
})

export interface WorkflowContext {
  taskId: string
  tenantId: string
  agentId: string
  agentSlug: string
  instructions: string
  taskTitle: string
  taskDescription?: string
  steps: Array<{
    id: string
    stepNumber: number
    title: string
    description?: string
    toolName?: string
  }>
  // Callbacks to report progress to Lambda API
  // These are the existing internal endpoints
  onStepComplete: (
    stepId: string,
    output: z.infer<typeof StepOutputSchema>
  ) => Promise<void>
  onStepFail: (
    stepId: string,
    error: string
  ) => Promise<void>
  onTaskComment: (
    comment: string
  ) => Promise<void>
}

export async function runMastraWorkflow(
  ctx: WorkflowContext
): Promise<void> {
  const agentConfig: TenantAgentConfig = {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    agentSlug: ctx.agentSlug,
    instructions: ctx.instructions,
  }

  const agent = await createTenantAgent(agentConfig)

  // Execute steps sequentially
  // Mirrors existing runTaskSteps() behavior
  // but uses Mastra agent instead of OpenClaw
  for (const step of ctx.steps.sort(
    (a, b) => a.stepNumber - b.stepNumber
  )) {
    try {
      const prompt = buildStepPrompt(
        ctx.taskTitle,
        ctx.taskDescription,
        step
      )

      const result = await agent.generate(prompt, {
        // Scope memory to this task session
        // memory.thread = threadId, memory.resource = resourceId
        memory: {
          thread: `task:${ctx.taskId}:step:${step.stepNumber}`,
          resource: ctx.tenantId,
        },
        structuredOutput: {
          schema: StepOutputSchema,
        },
      })

      const parsed = result.object as z.infer<
        typeof StepOutputSchema
      >

      await ctx.onStepComplete(step.id, {
        ...parsed,
        stepId: step.id,
      })

      // If agent needs clarification — stop execution
      // Same behavior as existing OpenClaw path
      if (parsed.status === 'needs_clarification') {
        await ctx.onTaskComment(
          `❓ ${parsed.question ??
            'Clarification needed before continuing.'}`
        )
        return
      }

      if (parsed.status === 'failed') {
        await ctx.onStepFail(
          step.id,
          parsed.summary ?? 'Step failed'
        )
        return
      }

    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : String(err)
      await ctx.onStepFail(step.id, message)
      return
    }
  }
}

function buildStepPrompt(
  taskTitle: string,
  taskDescription: string | undefined,
  step: {
    title: string
    description?: string
    toolName?: string
  }
): string {
  return [
    `Task: ${taskTitle}`,
    taskDescription
      ? `Context: ${taskDescription}`
      : null,
    ``,
    `Current step: ${step.title}`,
    step.description
      ? `Step details: ${step.description}`
      : null,
    step.toolName
      ? `Use tool: ${step.toolName}`
      : null,
    ``,
    `You MUST respond with valid JSON matching:`,
    `{`,
    `  "status": "done" | "needs_clarification" | "failed",`,
    `  "summary": "what you did or found",`,
    `  "reasoning": "why you did it this way",`,
    `  "question": "only if needs_clarification",`,
    `  "toolCalled": "tool name if you used one",`,
    `  "toolResult": "result summary if tool was used"`,
    `}`,
  ].filter(Boolean).join('\n')
}
