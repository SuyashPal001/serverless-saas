# Project Context

## Session Summary — April 29, 2026

The following bugs were identified, researched, and fixed across the frontend and agent execution layer.

---

### What Was Fixed

#### Frontend — `apps/web/components/platform/BoardView.tsx`

**Search scope expanded**
The board search previously only filtered by `task.title`. It now also matches against task ID (`task-xxxxxx` format) and `task.description`. Change is in the `filteredTasks` filter block.

**Drag-to-status cache invalidation fixed**
The `updateTaskStatus` mutation's `onSettled` previously only invalidated `['tasks']` (the board list cache). The task detail view uses a separate cache entry `['task', taskId]`. After a drag-and-drop status change, the detail view was showing stale status for up to 30 seconds, so the "Ask agent to plan" button (which requires `status === 'todo'`) never appeared. Fixed by adding `queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] })` alongside the existing invalidation.

---

#### Frontend — `apps/web/components/platform/TaskDetailView.tsx`

**"Work Items" breadcrumb now links to board**
The breadcrumb showed `Board > Work Items > TASK-XXXXXX`. "Work Items" was a dead `<span>`. It is now a `<Link>` pointing to `/${tenantSlug}/dashboard/board`.

**Task ID in breadcrumb is intentionally not a link**
Breadcrumb convention: the last item represents the current page and should never be a link. This is correct behavior, not a bug.

---

#### Agent Relay — `/opt/agent-relay/src/index.ts`

**Structured JSON output now required from LLM**
`buildStepPrompt()` previously ended with a vague instruction: "return a structured result." The LLM responded with free-form prose. The closing instruction has been replaced with an explicit JSON output format requirement:
```json
{
  "reasoning": "...",
  "toolRationale": "...",
  "results": [{ "title": "...", "url": "https://...", "description": "..." }],
  "summary": "..."
}
```
Rules enforced in the prompt: every URL must be complete (`https://...`), `results` is `[]` if the step produces no URLs, clarification signal moves to `summary` field as `NEEDS_CLARIFICATION: <question>`.

**Previous step context now passes full structured data**
Previously, each completed step passed `agentOutput.slice(0, 300)` — raw LLM prose truncated to 300 characters — as context to the next step. This caused URLs to be cut off mid-string, making Step 2 unable to fetch pages found in Step 1. The `CompletedStep` interface now carries `results`, `reasoning`, and `summary` fields. The context injection loop now passes `cs.summary` plus the full results array with complete URLs.

**JSON parsing with graceful fallback**
After `onDone`, the relay now attempts to parse structured JSON from `agentOutput` using a regex match. If the LLM returns invalid JSON (fallback for older prompts or edge cases), it logs a warning and falls back to treating the full text as `summary`. No crash, no data loss.

**Clarification detection now runs against `summary`**
Previously `extractClarificationQuestion()` ran against the raw `agentOutput`. It now runs against the parsed `summary` field, which contains the `NEEDS_CLARIFICATION:` signal when present.

**`reasoning` and `toolRationale` now sent to API on step completion**
The `callInternalTaskApi /complete` call now includes `reasoning` and `toolRationale` extracted from the parsed JSON.

---

#### API — `apps/api/src/routes/internal/tasks.ts`

**`reasoning` field accepted and persisted**
The Zod body schema for `POST /internal/tasks/:taskId/steps/:stepId/complete` now accepts `reasoning: z.string().optional()`. The Drizzle `.set()` call now writes `reasoning: reasoning ?? null` to the `taskSteps` table. The `reasoning` column already existed in the schema but had no code path writing to it — now it does.

---

### What Was Confirmed Not A Bug

- Board default filter state is `'all'` in code — screenshots showing narrow filters were taken mid-session after manual user interaction
- Task ID as non-clickable span in breadcrumb is correct UX

---

### Files Changed

| File | Location |
|---|---|
| `BoardView.tsx` | `apps/web/components/platform/BoardView.tsx` |
| `TaskDetailView.tsx` | `apps/web/components/platform/TaskDetailView.tsx` |
| `index.ts` (relay) | `/opt/agent-relay/src/index.ts` |
| `tasks.ts` (internal route) | `apps/api/src/routes/internal/tasks.ts` |
