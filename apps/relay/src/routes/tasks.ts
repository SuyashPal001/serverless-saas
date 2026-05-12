import { Hono } from 'hono'
import { TaskStep, TaskComment, CompletedStep, WorkflowStep, INTERNAL_SERVICE_KEY, INTERNAL_API_URL } from '../types.js'
import { checkMessageQuota, checkTokenQuota, fetchAgentSkill, fetchConnectedProviders, fetchToolGovernance, fetchAgentPolicy, recordUsage, getPool } from '../usage.js'
import { runMastraWorkflow, taskExecutionWorkflow } from '../mastra/index.js'
import type { WorkflowContext } from '../mastra/index.js'
import { filterPII } from '../pii-filter.js'

// ─── Task execution endpoint ──────────────────────────────────────────────────

async function callInternalTaskApi(path: string, body: Record<string, unknown>, traceId?: string): Promise<void> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY,
        ...(traceId ? { 'x-trace-id': traceId } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[tasks] internal API ${path} returned ${res.status}: ${text}`)
    }
  } catch (err) {
    console.error(`[tasks] internal API ${path} error:`, (err as Error).message)
  }
}

async function postTaskEval(params: {
  taskId: string
  tenantId: string
  taskTitle: string
  taskDescription: string | undefined
  finalOutput: string
}): Promise<void> {
  try {
    await fetch(`${INTERNAL_API_URL}/internal/evals/auto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify({
        conversationId: params.taskId,
        messageId: params.taskId,
        tenantId: params.tenantId,
        question: params.taskTitle,
        retrievedChunks: [],
        answer: params.finalOutput,
      }),
    })
  } catch (err) {
    // Fire and forget — never block task execution
    console.error('[eval] postTaskEval error:', (err as Error).message)
  }
}

async function logToolCall(params: {
  tenantId: string
  toolName: string
  success: boolean
  taskId?: string
  latencyMs?: number
  errorMessage?: string
  args?: Record<string, unknown>
}): Promise<void> {
  try {
    await fetch(`${INTERNAL_API_URL}/internal/tool-calls/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify(params),
    })
  } catch (err) {
    // Fire and forget — never block task execution
    console.error('[tool-log] failed to log tool call:', (err as Error).message)
  }
}

export async function fetchTaskComments(taskId: string): Promise<TaskComment[]> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/internal/tasks/${taskId}/comments`, {
      headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
    })
    if (!res.ok) {
      console.error(`[tasks] comments fetch ${taskId} returned ${res.status}`)
      return []
    }
    const data = await res.json() as TaskComment[] | { data?: TaskComment[]; comments?: TaskComment[] }
    return Array.isArray(data) ? data : (data.data ?? data.comments ?? [])
  } catch (err) {
    console.error(`[tasks] comments fetch error:`, (err as Error).message)
    return []
  }
}

async function postTaskComment(taskId: string, content: string, agentId: string): Promise<void> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/internal/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify({ content, agentId }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[tasks] post comment ${taskId} returned ${res.status}: ${text}`)
    }
  } catch (err) {
    console.error(`[tasks] post comment error:`, (err as Error).message)
  }
}

export function buildStepPrompt(
  step: TaskStep,
  taskTitle: string,
  taskDescription: string,
  completedSteps: CompletedStep[],
  comments: TaskComment[],
  referenceText?: string | null,
  links?: string[] | null,
  attachmentContext?: string | null
): string {
  const params = JSON.stringify(step.parameters, null, 2)
  const lines = [
    `<session_context>`,
    `task_step: ${step.title}`,
    `</session_context>`,
    ``,
    `You are executing a task step as part of an automated workflow.`,
    ``,
    `**Task Title:** ${taskTitle}`,
    `**Task Description:** ${taskDescription}`,
  ]

  if (referenceText) {
    lines.push(``, `## Reference Material`, `The user provided this reference text for context:`, referenceText)
  }

  if (attachmentContext) {
    lines.push(``, `## Attached Files`, `The user has attached the following files. Use this content to complete this step:`, attachmentContext)
  }

  if (links && links.length > 0) {
    lines.push(``, `## Relevant Links`, `The user attached these links. Use them as context or fetch their content if needed:`, ...links.map(l => `- ${l}`))
  }

  if (completedSteps.length > 0) {
    lines.push(``, `**Previously Completed Steps:**`)
    for (const cs of completedSteps) {
      lines.push(`- ✅ ${cs.title}: ${cs.summary}`)
      if (cs.results.length > 0) {
        lines.push(`  Results:`)
        for (const r of cs.results) {
          lines.push(`  - ${r.title}: ${r.url} — ${r.description}`)
        }
      }
    }
  }

  if (comments.length > 0) {
    lines.push(``, `**Comment History:**`)
    for (const comment of comments) {
      const author = comment.authorName ?? (comment.agentId ? 'Agent' : 'User')
      const timestamp = comment.createdAt ? ` (${comment.createdAt})` : ''
      lines.push(`- ${author}${timestamp}: ${comment.content}`)
    }
  }

  lines.push(
    ``,
    `**Current Step:** ${step.title}`,
    `**Description:** ${step.description}`,
    `**Tool:** ${step.toolName}`,
    `**Parameters:**`,
    '```json',
    params,
    '```',
    ``,
    `Execute this step using the ${step.toolName} tool with the provided parameters.`,
    ``,
    `After the tool has run and you have the results, write your final response as a single JSON object in this exact format:`,
    `{`,
    `  "reasoning": "<why this step was needed and what you did>",`,
    `  "toolRationale": "<why you chose this specific tool>",`,
    `  "results": [`,
    `    { "title": "<result title>", "url": "<complete URL starting with https://>", "description": "<what this is and why relevant>" }`,
    `  ],`,
    `  "summary": "<1-2 sentence human readable summary of what you found or did>"`,
    `}`,
    ``,
    `Important:`,
    `- Call the tool first. Write the JSON only after you have the tool results.`,
    `- Every URL must be complete (e.g. https://github.com/owner/repo)`,
    `- If the step produces no URLs, set results to []`,
    `- If you cannot proceed without user input, set summary to: NEEDS_CLARIFICATION: <your question>`,
  )
  return lines.join('\n')
}

export function extractClarificationQuestion(text: string): string | null {
  // [^\n"]+ stops at newline or closing quote — prevents consuming trailing JSON syntax
  // when summary falls back to raw agentOutput that still contains JSON characters
  const match = text.match(/NEEDS_CLARIFICATION:\s*([^\n"]+)/m)
  return match ? match[1].trim() : null
}

export async function fetchTenantMcpServers(tenantId: string): Promise<{ provider: string; mcpServerUrl: string }[]> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/internal/integrations/${tenantId}`, {
      headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
    })
    if (!res.ok) {
      console.error(`[tasks] fetchTenantMcpServers failed status=${res.status} tenantId=${tenantId}`)
      return []
    }
    const data = await res.json() as { data: { provider: string; mcpServerUrl: string | null }[] }
    return data.data
      .filter(i => i.mcpServerUrl != null)
      .map(i => ({ provider: i.provider, mcpServerUrl: i.mcpServerUrl! }))
  } catch (err) {
    console.error('[tasks] fetchTenantMcpServers error:', (err as Error).message)
    return []
  }
}

async function runMastraTaskSteps(
  taskId: string,
  agentId: string,
  tenantId: string,
  steps: TaskStep[],
  taskTitle: string,
  taskDescription: string,
  agentName: string,
  referenceText?: string | null,
  links?: string[] | null,
  attachmentContext?: string | null,
  acceptanceCriteria?: string | null,
  traceId: string = crypto.randomUUID()
): Promise<void> {
  // Quota guard — same pattern as runTaskSteps
  const quota = await checkMessageQuota(tenantId)
  if (!quota.allowed) {
    console.warn(`[mastra] tenantId=${tenantId} taskId=${taskId} quota exceeded used=${quota.used} limit=${quota.limit}`)
    await postTaskComment(taskId, `❌ Message quota exceeded (${quota.used}/${quota.limit} messages used this month). Upgrade your plan to continue.`, agentId)
    await callInternalTaskApi(`/internal/tasks/${taskId}/fail`, { error: 'Message quota exceeded' }, traceId)
    return
  }

  // Token quota gate — checks cumulative input+output tokens this month
  const tokenQuota = await checkTokenQuota(tenantId)
  if (!tokenQuota.allowed) {
    console.warn(`[mastra] tenantId=${tenantId} taskId=${taskId} token quota exceeded used=${tokenQuota.used} limit=${tokenQuota.limit}`)
    await postTaskComment(taskId, `❌ Token quota exceeded for your plan (${tokenQuota.used?.toLocaleString()}/${tokenQuota.limit?.toLocaleString()} tokens used this month). Upgrade to continue.`, agentId)
    await callInternalTaskApi(`/internal/tasks/${taskId}/fail`, { error: 'Token quota exceeded for your plan. Upgrade to continue.' }, traceId)
    return
  }

  const skill = await fetchAgentSkill(agentId)
  const instructions = skill?.systemPrompt
    ?? `You are ${agentName}, a helpful AI assistant.`

  // Fetch tool governance data — used to gate approval-required tools before
  // the agent ever attempts to call them.
  const connectedProviders = await fetchConnectedProviders(tenantId)
  const toolGovernance = await fetchToolGovernance(agentId, tenantId, connectedProviders)
  const policy = await fetchAgentPolicy(agentId, tenantId)

  // Merge requiresApproval from both tool registry and agent policy
  const mergedRequiresApproval = [
    ...new Set([
      ...toolGovernance.requiresApprovalTools,
      ...policy.requiresApproval,
    ])
  ]

  let earlyTermination = false
  const stepOutputs: string[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0

  const ctx: WorkflowContext = {
    taskId,
    tenantId,
    agentId,
    agentSlug: agentId, // fetchAgentSlug returns agentId unchanged
    instructions,
    taskTitle,
    taskDescription,
    steps: steps.map(s => ({
      id: s.id,
      stepNumber: s.stepOrder,
      title: s.title,
      description: s.description,
      toolName: s.toolName,
    })),
    connectedProviders,
    enabledTools: skill?.tools ?? null,
    highStakeTools: toolGovernance.highStakeTools,
    requiresApprovalTools: mergedRequiresApproval,
    blockedTools: policy.blockedActions,
    allowedTools: policy.allowedActions,
    maxTokensPerMessage: policy.maxTokensPerMessage,
    attachmentContext: attachmentContext ?? null,
    acceptanceCriteria: acceptanceCriteria ?? null,
    referenceText: referenceText ?? undefined,
    links: links ?? undefined,
    onStepStart: async (stepId) => {
      await callInternalTaskApi(`/internal/tasks/${taskId}/steps/${stepId}/start`, {}, traceId)
    },
    onStepComplete: async (stepId, output) => {
      stepOutputs.push(output.summary)
      // Lambda toolResult schema is z.record(z.unknown()).optional() — omit when absent
      const raw = output.toolResult
      const toolResult = raw == null
        ? undefined
        : typeof raw === 'object' && !Array.isArray(raw)
          ? raw as Record<string, unknown>
          : { result: raw }
      await callInternalTaskApi(
        `/internal/tasks/${taskId}/steps/${stepId}/complete`,
        {
          agentOutput: output.summary,
          summary: output.summary,
          reasoning: output.reasoning ?? undefined,
          actualToolUsed: output.toolCalled ?? undefined,
          ...(toolResult !== undefined && { toolResult }),
        },
        traceId
      )
      // Log tool call to ops dashboard if a tool was used
      if (output.toolCalled) {
        await logToolCall({
          tenantId,
          toolName: output.toolCalled,
          success: output.status === 'done',
          latencyMs: output.latencyMs,
          taskId,
          args: toolResult,
        })
      }
      totalInputTokens += output.inputTokens ?? 0
      totalOutputTokens += output.outputTokens ?? 0
    },
    onStepFail: async (stepId, error) => {
      earlyTermination = true
      await postTaskComment(taskId, `❌ Step failed: ${error}`, agentId)
      await callInternalTaskApi(`/internal/tasks/${taskId}/steps/${stepId}/fail`, { error }, traceId)
      // Log failed tool call if we know which tool was involved
      const failedStep = steps.find(s => s.id === stepId)
      if (failedStep?.toolName) {
        await logToolCall({
          tenantId,
          toolName: failedStep.toolName,
          success: false,
          errorMessage: error,
          taskId,
        })
      }
    },
    onTaskComment: async (comment) => {
      earlyTermination = true
      await postTaskComment(taskId, comment, agentId)
      await callInternalTaskApi(`/internal/tasks/${taskId}/clarify`, { questions: [comment] }, traceId)
    },
  }

  try {
    const run = await taskExecutionWorkflow.createRun()

    // Save runId immediately — needed to resume if workflow suspends at approvalStep
    await callInternalTaskApi(`/internal/tasks/${taskId}/mastra-run`, { mastraRunId: run.runId }, traceId)

    // Mark all task board steps as started
    for (const step of ctx.steps) {
      await ctx.onStepStart(step.id)
    }

    const result = await run.start({
      inputData: {
        taskTitle: ctx.taskTitle,
        taskDescription: ctx.taskDescription ?? '',
        acceptanceCriteria: ctx.acceptanceCriteria ?? '',
        tenantId: ctx.tenantId,
        attachmentContext: ctx.attachmentContext ?? '',
        referenceText: ctx.referenceText ?? '',
        links: ctx.links ?? [],
      },
    })

    if ((result as unknown as { status: string }).status === 'suspended') {
      // Workflow paused at approvalStep — put task in awaiting_approval, do not fail steps
      console.log(`[mastra] tenantId=${tenantId} taskId=${taskId} workflow suspended — awaiting approval`)
      await callInternalTaskApi(`/internal/tasks/${taskId}/suspend`, {}, traceId)
      return
    }

    if (result.status === 'success') {
      const steps = ctx.steps

      // Mark intermediate steps done with contextual messages — real output goes on the last step only
      const stepMessages = [
        'Analyzing task and generating search strategy...',
        'Searching across multiple sources in parallel...',
        'Merging and deduplicating results...',
      ]
      for (let i = 0; i < steps.length - 1; i++) {
        await ctx.onStepComplete(steps[i].id, {
          stepId: steps[i].id,
          summary: stepMessages[i] ?? `Step ${i + 1} completed`,
          status: 'done',
          reasoning: '',
          toolCalled: '',
          toolResult: '',
        })
      }

      // Extract token totals from the final step output (composeStep accumulates all step tokens)
      totalInputTokens = result.result?.inputTokens ?? 0
      totalOutputTokens = result.result?.outputTokens ?? 0
      console.log(`[mastra] tenantId=${tenantId} taskId=${taskId} tokens in=${totalInputTokens} out=${totalOutputTokens}`)

      // Last step gets the real workflow output
      const lastStep = steps[steps.length - 1]
      await ctx.onStepComplete(lastStep.id, {
        stepId: lastStep.id,
        summary: result.result?.summary ?? '',
        status: result.result?.status ?? 'done',
        reasoning: result.result?.reasoning ?? '',
        toolCalled: 'internet_search',
        toolResult: '',
      })
    } else {
      earlyTermination = true
      for (const step of ctx.steps) {
        await ctx.onStepFail(
          step.id,
          (result as unknown as { error?: { message?: string } }).error?.message ?? 'Workflow failed'
        )
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[mastra] tenantId=${tenantId} taskId=${taskId} workflow error:`, message)
    await postTaskComment(taskId, `❌ Task failed: ${message}`, agentId)
    await callInternalTaskApi(`/internal/tasks/${taskId}/fail`, { error: message }, traceId)
    return
  }

  if (!earlyTermination) {
    await postTaskComment(taskId, `✅ All steps completed.`, agentId)
    await callInternalTaskApi(`/internal/tasks/${taskId}/complete`, { summary: 'All steps completed successfully.' }, traceId)
    await postTaskEval({
      taskId,
      tenantId,
      taskTitle,
      taskDescription,
      finalOutput: stepOutputs.join('\n\n') || taskTitle,
    })
    recordUsage({
      tenantId,
      actorId: agentId,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    })
  }
}

// ─── Workflow execution endpoint ──────────────────────────────────────────────

async function runMastraWorkflowSteps(
  workflowId: string,
  workflowRunId: string,
  agentId: string,
  tenantId: string,
  steps: WorkflowStep[],
  systemPrompt: string | null,
  requiresApproval: boolean,
  traceId: string = crypto.randomUUID()
): Promise<void> {
  const skill = await fetchAgentSkill(agentId)
  const instructions = systemPrompt
    ?? skill?.systemPrompt
    ?? 'You are a helpful AI assistant.'

  const connectedProviders = await fetchConnectedProviders(tenantId)
  const toolGovernance = await fetchToolGovernance(agentId, tenantId, connectedProviders)
  const policy = await fetchAgentPolicy(agentId, tenantId)

  const mergedRequiresApproval = [
    ...new Set([
      ...toolGovernance.requiresApprovalTools,
      ...policy.requiresApproval,
      ...(requiresApproval ? ['*'] : []),
    ])
  ]

  const wfStepsCompleted: unknown[] = []
  const wfToolsCalled: unknown[] = []

  const ctx: WorkflowContext = {
    taskId: workflowRunId,
    tenantId,
    agentId,
    agentSlug: agentId,
    instructions,
    taskTitle: `Workflow ${workflowId}`,
    taskDescription: undefined,
    steps: steps.map((s, i) => ({
      id: s.id ?? `step-${i}`,
      stepNumber: s.stepNumber ?? i + 1,
      title: s.title,
      description: s.description,
      toolName: s.toolName,
    })),
    connectedProviders,
    enabledTools: skill?.tools ?? null,
    highStakeTools: toolGovernance.highStakeTools,
    requiresApprovalTools: mergedRequiresApproval,
    blockedTools: policy.blockedActions,
    allowedTools: policy.allowedActions,
    maxTokensPerMessage: policy.maxTokensPerMessage,
    onStepStart: async (_stepId) => { /* workflow steps have no separate start endpoint */ },
    onStepComplete: async (stepId, output) => {
      wfStepsCompleted.push({
        stepId,
        title: steps.find((s: WorkflowStep) => s.id === stepId)?.title ?? stepId,
        status: output.status,
        summary: output.summary,
        toolCalled: output.toolCalled ?? null,
        completedAt: new Date().toISOString(),
      })
      if (output.toolCalled) {
        wfToolsCalled.push({
          tool: output.toolCalled,
          result: output.toolResult ?? null,
        })
      }
      console.log(JSON.stringify({ level: 'info', msg: 'workflow step complete', traceId, workflowRunId, stepId, status: output.status, ts: Date.now() }))
    },
    onStepFail: async (stepId, error) => {
      wfStepsCompleted.push({
        stepId,
        status: 'failed',
        error,
        completedAt: new Date().toISOString(),
      })
      // POST workflow update — run failed
      await fetch(
        `${INTERNAL_API_URL}/internal/workflows/${workflowRunId}/update`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service-key': INTERNAL_SERVICE_KEY,
            'x-trace-id': traceId,
          },
          body: JSON.stringify({
            status: 'failed',
            stepsCompleted: wfStepsCompleted,
            toolsCalled: wfToolsCalled,
            completedAt: new Date().toISOString(),
          }),
        }
      ).catch((e: Error) => console.error('[workflow] update failed:', e.message))
      console.error(JSON.stringify({ level: 'error', msg: 'workflow step failed', traceId, workflowRunId, stepId, error, ts: Date.now() }))
    },
    onTaskComment: async (comment) => {
      console.log(`[workflows] workflowRunId=${workflowRunId} comment: ${comment}`)
    },
  }

  await runMastraWorkflow(ctx)

  // POST workflow update — run completed
  await fetch(
    `${INTERNAL_API_URL}/internal/workflows/${workflowRunId}/update`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        status: 'completed',
        stepsCompleted: wfStepsCompleted,
        toolsCalled: wfToolsCalled,
        insights: (wfStepsCompleted as Array<{ summary?: string }>)
          .map(s => s.summary)
          .filter(Boolean)
          .join('\n'),
        completedAt: new Date().toISOString(),
      }),
    }
  ).catch((e: Error) => console.error('[workflow] update failed:', e.message))
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const tasksRouter = new Hono()

tasksRouter.post('/api/tasks/execute', async (c) => {
  const serviceKey = c.req.header('x-internal-service-key') ?? ''
  if (!serviceKey || serviceKey !== INTERNAL_SERVICE_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let body: { taskId?: unknown; agentId?: unknown; tenantId?: unknown; steps?: unknown; taskTitle?: unknown; taskDescription?: unknown; agentName?: unknown; referenceText?: unknown; links?: unknown; attachmentContext?: unknown; acceptanceCriteria?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
  const steps: TaskStep[] = Array.isArray(body.steps) ? body.steps as TaskStep[] : []
  const rawTaskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : ''
  const rawTaskDescription = typeof body.taskDescription === 'string' ? body.taskDescription.trim() : ''
  const agentName = typeof body.agentName === 'string' && body.agentName.trim() ? body.agentName.trim() : 'Agent'
  const rawReferenceText = typeof body.referenceText === 'string' && body.referenceText.trim() ? body.referenceText.trim() : null
  const rawAttachmentContext = typeof body.attachmentContext === 'string' && body.attachmentContext.trim() ? body.attachmentContext.trim() : null
  const rawAcceptanceCriteria = typeof body.acceptanceCriteria === 'string' && body.acceptanceCriteria.trim() ? body.acceptanceCriteria.trim() : null
  const links = Array.isArray(body.links) ? (body.links as unknown[]).filter((l): l is string => typeof l === 'string' && l.trim() !== '') : null

  const { sanitized: taskTitle, detections: taskTitleD } = filterPII(rawTaskTitle)
  const { sanitized: taskDescription, detections: taskDescD } = filterPII(rawTaskDescription)
  const execRefResult = rawReferenceText !== null ? filterPII(rawReferenceText) : null
  const execAttResult = rawAttachmentContext !== null ? filterPII(rawAttachmentContext) : null
  const execAcResult = rawAcceptanceCriteria !== null ? filterPII(rawAcceptanceCriteria) : null
  const referenceText = execRefResult?.sanitized ?? null
  const attachmentContext = execAttResult?.sanitized ?? null
  const acceptanceCriteria = execAcResult?.sanitized ?? null
  const execPiiDetections = [...taskTitleD, ...taskDescD, ...(execRefResult?.detections ?? []), ...(execAttResult?.detections ?? []), ...(execAcResult?.detections ?? [])]
  if (execPiiDetections.length > 0) {
    const summary = execPiiDetections.reduce((acc, d) => { acc[d.type] = (acc[d.type] ?? 0) + d.count; return acc }, {} as Record<string, number>)
    console.log(`[pii-filter] tasks/execute taskId=${taskId} masked: ${Object.entries(summary).map(([t, c]) => `${t}×${c}`).join(' ')}`)
  }

  if (!taskId || !tenantId || steps.length === 0) {
    return c.json({ error: 'taskId, tenantId, and steps are required' }, 400)
  }

  const execQuota = await checkMessageQuota(tenantId)
  if (!execQuota.allowed) {
    console.warn(`[tasks] tenantId=${tenantId} taskId=${taskId} quota exceeded used=${execQuota.used} limit=${execQuota.limit}`)
    return c.json({ error: 'Message quota exceeded', used: execQuota.used, limit: execQuota.limit }, 429)
  }

  const traceId = c.req.header('x-trace-id') ?? crypto.randomUUID()
  console.log(JSON.stringify({ level: 'info', msg: 'task execution started', traceId, taskId, tenantId, steps: steps.length, ts: Date.now() }))

  // 4. Fire-and-forget — return 200 immediately; step loop runs async
  runMastraTaskSteps(taskId, agentId, tenantId, steps, taskTitle, taskDescription, agentName, referenceText, links, attachmentContext, acceptanceCriteria, traceId).catch((err: Error) => {
    console.error(JSON.stringify({ level: 'error', msg: 'mastra unhandled error', traceId, taskId, tenantId, error: err.message, ts: Date.now() }))
  })

  return c.json({ ok: true, taskId })
})

// ─── Mastra workflow resume endpoint ──────────────────────────────────────────
// Called by the Lambda API after the user approves a suspended workflow.
// Reconstructs the workflow run from storage using the saved mastraRunId,
// resumes from approvalStep, and handles step completion inline.

tasksRouter.post('/api/tasks/:taskId/resume', async (c) => {
  const serviceKey = c.req.header('x-internal-service-key') ?? ''
  if (!serviceKey || serviceKey !== INTERNAL_SERVICE_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const taskId = c.req.param('taskId')
  const traceId = c.req.header('x-trace-id') ?? crypto.randomUUID()
  const p = getPool()

  // 1. Fetch task — need mastraRunId, tenantId, agentId, and running steps
  const taskRes = await p.query<{
    mastra_run_id: string | null
    tenant_id: string
    agent_id: string | null
  }>(
    `SELECT mastra_run_id, tenant_id, agent_id FROM agent_tasks WHERE id = $1 LIMIT 1`,
    [taskId]
  )
  const task = taskRes.rows[0]
  if (!task) return c.json({ error: 'Task not found' }, 404)
  if (!task.mastra_run_id) return c.json({ error: 'No suspended workflow run for this task' }, 404)

  const { mastra_run_id: mastraRunId, tenant_id: tenantId, agent_id: agentId } = task

  // 2. Fetch running steps — needed to call complete/fail after resume
  const stepsRes = await p.query<{ id: string; step_number: number; title: string }>(
    `SELECT id, step_number, title FROM task_steps
     WHERE task_id = $1 AND status IN ('running', 'pending')
     ORDER BY step_number ASC`,
    [taskId]
  )
  const runningSteps = stepsRes.rows

  // 3. Reconstruct run from storage and resume.
  // run.resume() is fire-and-forget — it kicks off the workflow but returns immediately.
  // Poll the Studio runs API until the run reaches a terminal state (max 10 min).
  // After resume, the workflow runs parallel searches + compose — this takes several minutes.
  type ResumeResult = { status: string; result?: { summary?: string; status?: string; reasoning?: string; inputTokens?: number; outputTokens?: number }; error?: { message?: string } }
  let resumeResult: ResumeResult = { status: 'pending' }
  try {
    // Use the Studio HTTP API to resume — the TypeScript run.resume() doesn't
    // correctly transition the persisted snapshot state, but the Studio REST API does.
    const relayPort = process.env.PORT ?? '3001'
    const resumeUrl = `http://localhost:${relayPort}/studio/workflows/taskExecution/resume?runId=${mastraRunId}`
    const resumeRes = await fetch(resumeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'approval', resumeData: { approved: true } }),
    })
    if (!resumeRes.ok) {
      const resumeText = await resumeRes.text()
      throw new Error(`Studio resume returned ${resumeRes.status}: ${resumeText}`)
    }
    console.log(`[mastra/resume] Studio resume triggered runId=${mastraRunId}`)

    // Poll for completion (max 10 min at 10s intervals)
    const pollUrl = `http://localhost:${relayPort}/studio/workflows/taskExecution/runs/${mastraRunId}`
    let settled = false
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 10000))
      let pollData: Record<string, unknown>
      try {
        const pollRes = await fetch(pollUrl)
        if (!pollRes.ok) { console.warn(`[mastra/resume] poll ${i + 1} non-ok: ${pollRes.status}`); continue }
        pollData = await pollRes.json() as Record<string, unknown>
      } catch (pollErr) {
        console.warn(`[mastra/resume] poll ${i + 1} fetch error:`, (pollErr as Error).message)
        continue
      }
      const runStatus = pollData.status as string | undefined
      console.log(`[mastra/resume] poll ${i + 1} runId=${mastraRunId} status=${runStatus}`)
      if (runStatus === 'success') {
        resumeResult = { status: 'success', result: pollData.result as ResumeResult['result'] }
        settled = true
        break
      }
      if (runStatus === 'failed' || runStatus === 'error') {
        const errMsg = typeof pollData.error === 'object' && pollData.error !== null
          ? ((pollData.error as Record<string, unknown>).message as string | undefined) ?? JSON.stringify(pollData.error)
          : String(pollData.error ?? 'Workflow failed after resume')
        resumeResult = { status: 'failed', error: { message: errMsg } }
        settled = true
        break
      }
    }
    if (!settled) {
      resumeResult = { status: 'failed', error: { message: 'Workflow resume timed out after 10 minutes' } }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[mastra/resume] tenantId=${tenantId} taskId=${taskId} resume error:`, message)
    await postTaskComment(taskId, `❌ Resume failed: ${message}`, agentId ?? 'system')
    await callInternalTaskApi(`/internal/tasks/${taskId}/fail`, { error: message }, traceId)
    return c.json({ error: message }, 500)
  }

  if (resumeResult.status === 'success') {
    const totalInputTokens = resumeResult.result?.inputTokens ?? 0
    const totalOutputTokens = resumeResult.result?.outputTokens ?? 0
    console.log(`[mastra/resume] tenantId=${tenantId} taskId=${taskId} success tokens in=${totalInputTokens} out=${totalOutputTokens}`)

    const stepMessages = [
      'Analyzing task and generating search strategy...',
      'Searching across multiple sources in parallel...',
      'Merging and deduplicating results...',
    ]

    for (let i = 0; i < runningSteps.length - 1; i++) {
      await callInternalTaskApi(
        `/internal/tasks/${taskId}/steps/${runningSteps[i].id}/complete`,
        {
          agentOutput: stepMessages[i] ?? `Step ${i + 1} completed`,
          summary: stepMessages[i] ?? `Step ${i + 1} completed`,
        },
        traceId
      )
    }

    if (runningSteps.length > 0) {
      const lastStep = runningSteps[runningSteps.length - 1]
      await callInternalTaskApi(
        `/internal/tasks/${taskId}/steps/${lastStep.id}/complete`,
        {
          agentOutput: resumeResult.result?.summary ?? '',
          summary: resumeResult.result?.summary ?? '',
          reasoning: resumeResult.result?.reasoning ?? undefined,
          actualToolUsed: 'internet_search',
        },
        traceId
      )
    }

    await postTaskComment(taskId, `✅ All steps completed.`, agentId ?? 'system')
    await callInternalTaskApi(`/internal/tasks/${taskId}/complete`, { summary: 'All steps completed successfully.' }, traceId)
    recordUsage({ tenantId, actorId: agentId ?? 'system', inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
  } else {
    const message = resumeResult.error?.message ?? 'Workflow failed after resume'
    console.error(`[mastra/resume] tenantId=${tenantId} taskId=${taskId} workflow failed:`, message)
    for (const step of runningSteps) {
      await callInternalTaskApi(`/internal/tasks/${taskId}/steps/${step.id}/fail`, { error: message }, traceId)
    }
    await postTaskComment(taskId, `❌ Task failed: ${message}`, agentId ?? 'system')
    await callInternalTaskApi(`/internal/tasks/${taskId}/fail`, { error: message }, traceId)
    return c.json({ error: message }, 500)
  }

  return c.json({ ok: true })
})

tasksRouter.post('/api/workflows/execute', async (c) => {
  const serviceKey = c.req.header('x-internal-service-key') ?? ''
  if (!serviceKey || serviceKey !== INTERNAL_SERVICE_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let body: {
    workflowId?: unknown
    workflowRunId?: unknown
    tenantId?: unknown
    agentId?: unknown
    steps?: unknown
    systemPrompt?: unknown
    requiresApproval?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
  const workflowRunId = typeof body.workflowRunId === 'string' ? body.workflowRunId.trim() : ''
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const steps: WorkflowStep[] = Array.isArray(body.steps) ? body.steps as WorkflowStep[] : []
  const systemPrompt = typeof body.systemPrompt === 'string' && body.systemPrompt.trim() ? body.systemPrompt.trim() : null
  const requiresApproval = body.requiresApproval === true

  if (!workflowId || !workflowRunId || !tenantId || !agentId) {
    return c.json({ error: 'workflowId, workflowRunId, tenantId, and agentId are required' }, 400)
  }

  const quota = await checkMessageQuota(tenantId)
  if (!quota.allowed) {
    console.warn(`[workflows] tenantId=${tenantId} workflowId=${workflowId} quota exceeded used=${quota.used} limit=${quota.limit}`)
    return c.json({ error: 'Message quota exceeded', used: quota.used, limit: quota.limit }, 429)
  }

  const traceId = c.req.header('x-trace-id') ?? crypto.randomUUID()
  console.log(JSON.stringify({ level: 'info', msg: 'workflow execution started', traceId, workflowId, workflowRunId, tenantId, steps: steps.length, ts: Date.now() }))

  // Fire-and-forget — return 200 immediately; Mastra workflow runs async
  runMastraWorkflowSteps(workflowId, workflowRunId, agentId, tenantId, steps, systemPrompt, requiresApproval, traceId).catch((err: Error) => {
    console.error(JSON.stringify({ level: 'error', msg: 'workflow unhandled error', traceId, workflowId, workflowRunId, tenantId, error: err.message, ts: Date.now() }))
  })

  return c.json({ ok: true, workflowRunId })
})
