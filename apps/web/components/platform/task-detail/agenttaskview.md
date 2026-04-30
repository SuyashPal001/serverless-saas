# TaskDetailView — Architecture Reference

Status: refactor complete. This document reflects the code as built.

---

## Section 1 — Current Architecture

### Component tree

```
TaskDetailView  (apps/web/components/platform/TaskDetailView.tsx, 388 lines)
  Orchestrator. Owns all queries, mutations, state, refs, and
  derived objects. Renders the layout shell only.
  │
  ├── TaskHeader
  │     apps/web/components/platform/task-detail/TaskHeader.tsx (113 lines)
  │
  ├── TaskMainContent
  │     apps/web/components/platform/task-detail/TaskMainContent.tsx (166 lines)
  │     │
  │     └── ExecutionConsole
  │           apps/web/components/platform/task-detail/ExecutionConsole.tsx (65 lines)
  │           │
  │           ├── NoPlanPhase       phases/NoPlanPhase.tsx        (34 lines)
  │           ├── PlanningPhase     phases/PlanningPhase.tsx      (51 lines)
  │           ├── PlanningFailedPhase  phases/PlanningFailedPhase.tsx  (63 lines)
  │           ├── ClarificationPhase   phases/ClarificationPhase.tsx   (70 lines)
  │           ├── PlanReviewPhase   phases/PlanReviewPhase.tsx    (50 lines)
  │           │     └── StepCard    task-detail/StepCard.tsx      (339 lines)
  │           ├── ExecutionPhase    phases/ExecutionPhase.tsx     (53 lines)
  │           │     └── StepCard
  │           └── ReviewPhase       phases/ReviewPhase.tsx        (256 lines)
  │
  ├── TaskSidebar
  │     apps/web/components/platform/task-detail/TaskSidebar.tsx (500 lines)
  │
  └── ActivityFeed
        apps/web/components/platform/task-detail/ActivityFeed.tsx (231 lines)
        Owns its own useQuery(['task-comments', taskId]).
```

### TaskDetailView

Owns:
- `useQuery(['task', taskId])` — refetchInterval 30 000 ms
- `useQuery(['agents'])` and `useQuery(['members'])` — for assignee dropdown
- `useTaskStream(taskId)` — intentional no-op stub; all WebSocket handling is in `GlobalTaskStreamProvider`
- Polling `useEffect` — 5 s interval when `task.status === 'in_progress'`
- Draft sync `useEffect` — resets all draft values when `task.id` changes
- All `useMutation` calls: `patchTask`, `voteMutation`, `deleteTaskMutation`,
  `approvePlanMutation`, `clarifyMutation`, `generatePlanMutation`
- All edit `useState`: `isEditing`, `isSaving`, `draftTitle`, `draftDescription`,
  `draftStatus`, `draftPriority`, `draftAssigneeKey`, `draftStartedAt`,
  `draftDueDate`, `draftEstimatedHours`
- `isUploadingAttachment` state
- `selectedAssignee` derived via `useMemo` from task assigneeId/agentId + assigneeOptions
- Refs: `attachFileInputRef`, `newLinkInputRef`, `referenceTextRef`, `pollingIntervalRef`
- `taskOperations` object — `useMemo`, passed as single prop to all children
- `editState` object — plain object, passed to children that need edit mode

Renders:
- Hidden `<input type="file" ref={attachFileInputRef}>` — must be in orchestrator DOM
- `<TaskHeader>`
- `<div className="flex flex-1 min-h-0 overflow-hidden">` containing `<TaskMainContent>` and `<TaskSidebar>`
- `<ActivityFeed>` outside the flex div

### TaskHeader

Props received:
```ts
task: Task
editState: {
  isEditing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}
taskOperations: {
  vote: (direction: 'up' | 'down') => Promise<void>
  deleteTask: () => Promise<void>
}
```

Renders: breadcrumb (Board → Work Items → TASK-{id}), upvote/downvote buttons
showing `task.upvotes`/`task.downvotes`, Edit/Cancel/Save buttons conditioned on
`editState.isEditing`, delete dropdown with `window.confirm`.

No state. No queries.

### TaskSidebar

Props received:
```ts
task: Task
steps: Step[]
editState: {
  isEditing: boolean
  draftStatus: string
  draftPriority: string
  draftAssigneeKey: string
  setDraftStatus: (v: string) => void
  setDraftPriority: (v: string) => void
  setDraftAssigneeKey: (v: string) => void
}
taskOperations: {
  approvePlan: (opts?: { approved: boolean }) => Promise<void>
  deleteTask: () => Promise<void>
  removeLink: (url: string) => void
  addLink: (url: string) => void
  removeAttachment: (fileId: string) => void
  startTask: () => void
  saveReferenceText: (text: string | null) => void
}
assigneeOptions: Array<{ type: 'agent' | 'member'; id: string; name: string }>
selectedAssignee: { type: 'agent' | 'member'; id: string; name: string } | null
isUploadingAttachment: boolean
attachFileInputRef: React.RefObject<HTMLInputElement>
newLinkInputRef: React.RefObject<HTMLInputElement>
referenceTextRef: React.RefObject<HTMLTextAreaElement>
```

Renders: 300 px right column. Properties section (status, priority, assignee,
estimated hours, confidence, steps progress, created, updated). Status/priority/assignee
render as editable dropdowns when `isEditing`. Links list (url-based removal). Attachment
list with download. Reference textarea (editable in edit mode, `onBlur` calls
`saveReferenceText`). Actions section (Approve Plan, Start Task, Delete Task) conditioned
on `task.status`.

Local state: `newLink` string for the link input.

No queries.

### TaskMainContent

Props received:
```ts
task: Task
steps: Step[]
events: TaskEvent[]
taskOperations: {
  approvePlan: (opts?: { approved: boolean; generalInstruction?: string }) => Promise<void>
  rejectPlan: () => Promise<void>
  generatePlan: () => Promise<void>
  sendClarification: (answer: string) => Promise<void>
  markDone: () => Promise<void>
  updateTitle: (title: string) => Promise<void>
  updateDescription: (desc: string) => Promise<void>
  updateCriteria: (criteria: AcceptanceCriterion[]) => void | Promise<void>
  addLink: (url: string, label?: string) => void | Promise<void>
  removeLink: (url: string) => void | Promise<void>
  removeAttachment: (fileId: string) => void | Promise<void>
  focusLinkInput: () => void
  focusReferenceInput: () => void
  triggerAttachFile: () => void
}
editState: {
  isEditing: boolean
}
```

Renders (in order): title (`<h1>` or `<input>` when editing), description (`<p>` or
`<textarea>` when editing), action buttons row (Add Link, Attach File, Reference),
acceptance criteria checklist when `task.acceptanceCriteria.length > 0`, `<ExecutionConsole>`.

Local state: `editingTitle`, `editingDescription`. Both are reset via `useEffect([task.id])`.
`onBlur` handlers call `updateTitle` / `updateDescription` only when value has changed.
Criterion toggle calls `updateCriteria` with the full updated array.

No queries. No mutations.

### ActivityFeed

Props received:
```ts
taskId: string
events: TaskEvent[]
```

Owns: `useQuery(['task-comments', taskId])`. Owns `addComment` mutation including
its optimistic update (cancel in-flight query, insert temporary comment, rollback on error).

Renders: tab bar (All / Activity / Events), filtered event timeline with icons, comments
list, add-comment textarea with Cmd+Enter shortcut and Send button.

Local state: `activeTab`, `commentText`.

### ExecutionConsole

Props received:
```ts
task: Task
steps: Step[]
events: TaskEvent[]
taskOperations: {
  approvePlan: (opts?: { approved: boolean; generalInstruction?: string }) => Promise<void>
  rejectPlan: () => Promise<void>
  generatePlan: () => Promise<void>
  sendClarification: (answer: string) => Promise<void>
  markDone: () => Promise<void>
}
```

Calls `getPhase(task.status, steps, task.blockedReason)` and renders exactly one phase
component via `switch`. No rendering of its own beyond the phase component.

No state. No queries.

### StepCard

Props received:
```ts
step: Step
index: number
```

Renders: step number badge (styled by status), title, description, tool badge, estimated
hours, confidence bar, "Why this?" button. When `step.status === 'running'` and live data
is present, renders `LiveActivityFeed`. When step has output, renders `AgentOutputRenderer`
or raw `<pre>` for JSON. Opens `StepInsightsModal` on "Why this?" click.

Local state: `insightsOpen: boolean`.

Sub-components defined in the same file: `AgentOutputRenderer`, `LiveActivityFeed`,
`StepReasoning`, `StepInsightsModal`. Helper functions: `parseEmailEntries`,
`getToolInfo`. `StepReasoning` is also exported.

No queries. No mutations.

### Phase components

**NoPlanPhase** (`task: Task`, `onGeneratePlan: () => void`)
If `task.agentId` is set: "Ready to plan" card with Generate Plan button.
Else: "Assign an agent" muted text. No local state.

**PlanningPhase** (`task: Task` (unused), `events: TaskEvent[]`)
If any event has type `plan_rejected` or `clarification_answered`: amber "Revising..."
notice. Else: "Saarthi is planning..." notice. Always renders four `PlanningStepSkeleton`
animated skeleton cards. `PlanningStepSkeleton` is a local function component. No state.

**PlanningFailedPhase** (`task: Task`, `onRetry: (instruction: string) => void`)
Red "Planning Interrupted" card with `task.blockedReason` displayed. Suggested fixes list.
Textarea for retry instruction. Retry button disabled when input is empty. On submit calls
`onRetry(retryInput)` and clears input. Local state: `retryInput: string`.

**ClarificationPhase** (`task: Task`, `events: TaskEvent[]`, `onSendClarification: (answer: string) => void`)
Derives `questions` from `events.find(e => e.eventType === 'clarification_requested')?.payload?.questions`,
normalised to `string[]`. Falls back to `task.blockedReason` stripped of prefix if no
event found. Renders each question numbered. Textarea for answer. Send Answer button
disabled when input empty. Calls `onSendClarification(answer)` on submit and clears input.
Local state: `answer: string`.

**PlanReviewPhase** (`task: Task`, `steps: Step[]`, `onApprovePlan: () => void`, `onRejectPlan: () => void`)
Renders `StepCard` for each step with fade-in animation. When
`task.status === 'awaiting_approval'`: bottom bar with Request Changes (calls `onRejectPlan`)
and Approve Plan (calls `onApprovePlan`) buttons. No local state.

**ExecutionPhase** (`task: Task`, `steps: Step[]`)
Status badge: `task.status === 'ready'` → "Plan approved · Awaiting execution" (emerald),
else → "Agent is executing" (primary, spinning loader). Progress bar. Renders `StepCard`
for each step. No local state.

**ReviewPhase** (`task: Task`, `steps: Step[]`, `onMarkDone: () => void`)
Emerald receipt card. Derives: `summary` (first sentence of first done step output),
`toolsTouched` (unique tool names from steps), `assumptions` (assumption paragraph from
output). `ReceiptResults` renders email list (detected via `parseEmailEntries`) or
step-by-step output. View raw toggle. Mark as Done button visible when
`task.status === 'review'`. Local state: `showRaw: boolean`. Helper functions
(`parseEmailEntries`, `extractFirstSentence`, `extractAssumptions`, `getToolInfo`) and
sub-components (`AgentOutputRenderer`, `StepResult`, `ReceiptResults`) defined in same file.

---

## Section 2 — Phase Logic

### TaskPhase union type

```ts
export type TaskPhase =
  | 'no_plan'
  | 'planning'
  | 'planning_failed'
  | 'clarification'
  | 'plan_review'
  | 'execution'
  | 'review'
```

### getPhase() — exact implementation

File: `apps/web/lib/taskPhase.ts`

```ts
export function getPhase(
  status: string,
  steps: Step[],
  blockedReason?: string | null
): TaskPhase {
  if (status === 'planning') return 'planning'
  if (status === 'blocked') {
    if (blockedReason?.includes('Planning failed') && steps.length === 0)
      return 'planning_failed'
    return 'clarification'
  }
  if (status === 'awaiting_approval') return 'plan_review'
  if (status === 'ready' || status === 'in_progress') return 'execution'
  if (status === 'review' || status === 'done') return 'review'
  if (steps.length === 0) return 'no_plan'
  const allDone = steps.every(s => s.status === 'done')
  if (allDone) return 'review'
  return 'plan_review'
}
```

### Phase mapping table

| task.status | blockedReason | steps | Phase |
|---|---|---|---|
| `planning` | any | any | `planning` |
| `blocked` | includes 'Planning failed' | empty | `planning_failed` |
| `blocked` | anything else | any | `clarification` |
| `awaiting_approval` | any | any | `plan_review` |
| `ready` | any | any | `execution` |
| `in_progress` | any | any | `execution` |
| `review` | any | any | `review` |
| `done` | any | any | `review` |
| `backlog` / `todo` / `cancelled` / other | any | empty | `no_plan` |
| `backlog` / `todo` / `cancelled` / other | any | all done | `review` |
| `backlog` / `todo` / `cancelled` / other | any | mixed | `plan_review` |

The last three rows are fallthrough cases for statuses not otherwise matched. In practice
`backlog` and `todo` with no steps lands on `no_plan`.

---

## Section 3 — Data Flow

### Query to render

```
useQuery(['task', taskId])
  → data.data.task    → task
  → data.data.steps   → steps
  → data.data.events  → events
  → data.data.agent   → used for selectedAssignee fallback name
  → data.data.assignee → used for selectedAssignee fallback name

useQuery(['agents'])  → agentsData.data (filtered to active)
useQuery(['members']) → membersData.members
  → combined into assigneeOptions: Assignee[]
  → selectedAssignee derived via useMemo from task.assigneeId / task.agentId

task, steps, events → passed as props to TaskHeader, TaskMainContent, TaskSidebar
assigneeOptions, selectedAssignee → passed as props to TaskSidebar
```

### WebSocket architecture

**Single connection, owned by `GlobalTaskStreamProvider`.**

`GlobalTaskStreamProvider` (dashboard layout) opens one AWS API Gateway WebSocket
connection (`NEXT_PUBLIC_WS_URL = wss://6s57mritv6.execute-api.ap-south-1.amazonaws.com/dev`)
for the lifetime of the dashboard session. Auth: short-lived HS256 JWT (`ws-token`)
fetched from `GET /api/v1/auth/ws-token` and passed as `?token=` query param.

On `$connect`, the API Gateway Lambda handler calls `cache.sadd(ws:tenant:{id}:user:{uid}, connectionId)`
— a Redis **Set** per user per tenant, not a single-value key. Multiple browser tabs each
register their own `connectionId` and all receive every event.

`useTaskStream` is an **intentional no-op stub** — it exists only to preserve the call
signature in `TaskDetailView` so that file needs no changes. All event handling lives
exclusively in `GlobalTaskStreamProvider`.

**Why the prior two-connection design caused bugs:** both hooks fetched a `ws-token` and
connected to the same API Gateway URL. Both `connectionId`s were registered via `sadd`.
The fan-out loop in `pushWebSocketEvent` sent every event to both connections, causing
duplicate `queryClient.setQueryData` calls and double toast notifications.

**Cache writes per event type:**

| WS event type | Cache mutation | Notes |
|---|---|---|
| `task.step.delta` | Sets `step.liveText = ev.text` | — |
| `task.step.tool_call` | Appends to `step.liveActivity` | — |
| `task.step.tool_result` | Marks last open tool_call completed | — |
| `task.step.thinking` | Sets `step.agentThinking = true` | — |
| `task.step.updated` | Sets status, agentOutput, startedAt/completedAt; clears liveText/liveActivity/agentThinking on `done`/`failed`/`skipped` | — |
| `task.step.created` | Appends new step to steps array (with dedup) | — |
| `task.status.changed` | Sets `task.status`; invalidates `['task', taskId]` on `awaiting_approval` | — |
| `task.clarification.requested` | Sets `task.status = 'blocked'`, appends event | — |
| `task.comment.added` | Appends to `['task-comments', taskId]` | different key |

Every cache write triggers automatic re-renders of all components subscribed to that key
via TanStack Query. No prop drilling of WebSocket data.

On reconnect after a disconnect, `GlobalTaskStreamProvider` invalidates both `['tasks']`
and `['task']` prefix queries to catch up on missed events.

### Query key ownership

| Query key | Owner | Receives WS updates |
|---|---|---|
| `['task', taskId]` | TaskDetailView | Yes — all step/task events |
| `['task-comments', taskId]` | ActivityFeed | Yes — task.comment.added |
| `['agents']` | TaskDetailView | No |
| `['members']` | TaskDetailView | No |
| `['tasks']` | Invalidated on task delete | N/A |

### Why TaskSidebar has no query

`useTaskStream` writes exclusively to `['task', taskId]`. If TaskSidebar used
`useQuery(['task', taskId, 'sidebar'])` or any key other than `['task', taskId]`, it
would never receive WebSocket updates. Status, priority, and assignee displayed in the
sidebar would be permanently stale after any agent execution. TaskSidebar therefore
receives `task` as a prop from the orchestrator's single query.

---

## Section 4 — taskOperations Contract

Defined in TaskDetailView with `useMemo`. Dependency array:
`[taskId, patchTask, voteMutation, task?.links, task?.attachmentFileIds]`.

`task?.links` and `task?.attachmentFileIds` are in dependencies because `addLink`,
`removeLink`, `removeAttachment` close over the current array values to compute the
next array.

| Operation | Signature | Calls |
|---|---|---|
| `approvePlan` | `(opts?: { approved: boolean; feedback?: Record<string, string>; generalInstruction?: string }) => Promise<void>` | `approvePlanMutation.mutateAsync(opts ?? { approved: true })` |
| `rejectPlan` | `() => Promise<void>` | `approvePlanMutation.mutateAsync({ approved: false })` |
| `generatePlan` | `() => Promise<void>` | `generatePlanMutation.mutateAsync()` |
| `sendClarification` | `(answer: string) => Promise<void>` | `clarifyMutation.mutateAsync(answer)` |
| `markDone` | `() => Promise<void>` | `patchTask.mutateAsync({ status: 'done' })` |
| `updateTitle` | `(title: string) => Promise<void>` | `patchTask.mutateAsync({ title })` |
| `updateDescription` | `(desc: string) => Promise<void>` | `patchTask.mutateAsync({ description: desc \|\| null })` |
| `deleteTask` | `() => Promise<void>` | `deleteTaskMutation.mutateAsync()` |
| `vote` | `(direction: 'up' \| 'down') => Promise<void>` | `voteMutation.mutateAsync(direction)` |
| `addLink` | `(url: string) => void` | `patchTask.mutate({ links: [...(task?.links ?? []), url] })` |
| `removeLink` | `(url: string) => void` | `patchTask.mutate({ links: (task?.links ?? []).filter(l => l !== url) })` |
| `addAttachment` | `(file: File) => Promise<void>` | `handleAttachmentUpload(file)` — see below |
| `removeAttachment` | `(fileId: string) => void` | `patchTask.mutate({ attachmentFileIds: ...filter })` |
| `saveReferenceText` | `(text: string \| null) => void` | `patchTask.mutate({ referenceText: text })` |
| `startTask` | `() => void` | `patchTask.mutate({ status: 'in_progress', startedAt: new Date().toISOString() })` |
| `updateCriteria` | `(criteria: AcceptanceCriterion[]) => void` | `patchTask.mutate({ acceptanceCriteria: criteria })` |
| `focusLinkInput` | `() => void` | `getElementById('links-section')?.scrollIntoView` + `setTimeout(() => newLinkInputRef.current?.focus(), 300)` |
| `focusReferenceInput` | `() => void` | `getElementById('reference-section')?.scrollIntoView` + `setTimeout(() => referenceTextRef.current?.focus(), 300)` |
| `triggerAttachFile` | `() => void` | `attachFileInputRef.current?.click()` |

### handleAttachmentUpload (3-step S3 upload)

1. `POST /api/v1/files/upload` with `{ filename, contentType }` → receives `{ fileId, uploadUrl }`
2. `PUT uploadUrl` with file body directly to S3
3. `POST /api/v1/files/{fileId}/confirm` with `{ size: file.size }`
4. `patchTask.mutate({ attachmentFileIds: [...existing, fileId] })`

Sets `isUploadingAttachment` true for the duration, false in `finally`.

---

## Section 5 — editState Contract

```ts
const editState = {
  isEditing: boolean,          // true after onEdit(), false after onCancel() or onSave()
  isSaving: boolean,           // true while onSave() is awaiting saveEdits()
  draftStatus: Task['status'], // working copy for sidebar status dropdown
  draftPriority: Task['priority'], // working copy for sidebar priority dropdown
  draftAssigneeKey: string,    // 'unassigned' | 'member:{id}' | 'agent:{id}'
  setDraftStatus: (v: string) => void,
  setDraftPriority: (v: string) => void,
  setDraftAssigneeKey: (v: string) => void,
  onEdit: () => void,          // sets isEditing(true); drafts are pre-synced by useEffect
  onCancel: () => void,        // sets isEditing(false); resets status/priority/assigneeKey from task
  onSave: () => Promise<void>, // setIsSaving(true), saveEdits(), setIsSaving(false), setIsEditing(false)
}
```

Fields NOT in editState but managed in orchestrator state: `draftTitle`, `draftDescription`,
`draftStartedAt`, `draftDueDate`, `draftEstimatedHours`. These are internal to `saveEdits()`
and are not needed by any child component. They are initialised by the draft sync effect and
not passed to children.

### Draft sync effect

Runs when `task?.id` changes (task navigation, initial load). Sets all draft values from
the current task. Does not run on polling refreshes to the same task, so in-progress edits
are not overwritten during live updates.

### saveEdits()

Diffs all draft values against the current task. Only includes changed fields in the
PATCH body. Handles: title, description, status, priority, assigneeId/agentId (parsed
from `draftAssigneeKey`), startedAt, dueDate, estimatedHours. Calls
`patchTask.mutateAsync(updates)` only if there are changes.

---

## Section 6 — Architectural Decisions

### Refs stay in the orchestrator

`attachFileInputRef`, `newLinkInputRef`, `referenceTextRef` each attach to a DOM element
in one child and are called from a different child. React refs must be created in a scope
that has access to both the element and the caller. The orchestrator is that scope.
Moving any ref to a child component would cause silent failures: the click or focus call
would silently do nothing because `ref.current` would be null from the caller's perspective.

The hidden `<input type="file">` is rendered directly in `TaskDetailView`, not in
`TaskMainContent` or `TaskSidebar`, for this same reason. `triggerAttachFile()` calls
`attachFileInputRef.current?.click()` — the input must be in the DOM at all times, not
conditionally rendered inside a child.

### TaskSidebar is not an independent query

See Section 3. `GlobalTaskStreamProvider` writes all step/task events to `['task', taskId]`.
Any component using a different query key would never receive those updates. The sidebar
must receive `task` as a prop from the orchestrator's single query, or its
status/priority/assignee display will never update during agent execution.

### ActivityFeed is the only independent query

Comments are a separate resource (`/api/v1/tasks/{id}/comments`) with a separate query
key (`['task-comments', taskId]`). `GlobalTaskStreamProvider` routes `task.comment.added`
events to this key, not to `['task', taskId]`. ActivityFeed owns both the read query and
the `addComment` mutation with its optimistic update. No other component needs comment
data. This is the correct boundary: comments are a self-contained concern.

### planApprovedAt is not used in render conditions

`planApprovedAt` is a nullable timestamp on `Task`. It was previously used to render
a "plan approved awaiting execution" badge. The refactor replaced this with
`task.status === 'ready'` as the discriminator in `ExecutionPhase`. `task.status` is the
authoritative state field. Using a derived timestamp creates a secondary source of truth
that can drift (e.g., if status is reset but timestamp is not cleared). No file in the
component tree reads `planApprovedAt`.

### blocked maps to two phases

`task.status === 'blocked'` covers two distinct UX scenarios:

1. **planning_failed** — agent failed to produce a plan. Discriminator:
   `blockedReason?.includes('Planning failed') && steps.length === 0`.
   Renders a red error card with retry flow.
2. **clarification** — agent is waiting for human input before it can plan.
   All other `blocked` cases. Renders a question card with answer textarea.

The two phases have opposite next actions (retry planning vs. answer questions) and must
not be merged. The `blockedReason` string is set by the backend; `steps.length === 0`
confirms that planning never produced any output.

### removeLink is URL-based, not index-based

`task.links` is `string[]` — an array of URL strings with no IDs. The original
implementation used array index as the removal key. Index-based removal is fragile
because the index of a link can change if another mutation (e.g. addLink) runs
concurrently before the remove renders. URL-based removal (`filter(l => l !== url)`)
is deterministic and idempotent. TaskSidebar was updated from `removeLink(i)` to
`removeLink(link)` (the URL string) as part of this change. This also allows
TaskMainContent and TaskSidebar to share the same `removeLink` operation without
needing separate implementations.

---

## Section 7 — What Is Not Done Yet: Subtasks

The current phase system (NoPlanPhase through ReviewPhase) represents the agent's
own execution plan — a sequence of steps the agent will carry out autonomously.

Subtasks are a separate concept that does not exist in the codebase yet:

- Subtasks are human-created and human-executed checklist items, not agent steps.
- An agent task and its subtasks can coexist on the same parent task simultaneously.
  A user might break down a task into human subtasks while also having the agent execute
  its own steps.
- There is currently no relationship between subtasks and agent steps. They would be
  tracked separately and displayed in separate UI sections.
- No database schema exists for subtasks. The `acceptanceCriteria` field (`{ text, checked }[]`)
  is the closest current concept but it is not the same thing — criteria are completion
  conditions, not work items.
- No UI has been designed or specced for subtask creation, assignment, or tracking.

This is not an oversight in the refactor. The refactor extracted the existing agent
phase flow. Subtasks are a future feature that requires separate schema design, API
endpoints, and UI work.

---

## Section 8 — File Index

Files created or materially modified in this refactor.

| File | Lines | Description |
|---|---|---|
| `apps/web/types/task.ts` | 89 | Shared types: Task, Step, TaskEvent, TaskComment, AcceptanceCriterion, Attachment, TaskDetailResponse, AgentsResponse, MembersResponse, Assignee |
| `apps/web/lib/taskPhase.ts` | 30 | TaskPhase union type and getPhase() function |
| `apps/web/components/platform/TaskDetailView.tsx` | 388 | Orchestrator: all queries, mutations, state, refs, taskOperations, editState, layout shell |
| `apps/web/components/platform/task-detail/TaskHeader.tsx` | 113 | Breadcrumb, vote buttons, Edit/Cancel/Save, delete dropdown |
| `apps/web/components/platform/task-detail/TaskSidebar.tsx` | 500 | Right 300 px column: properties, links, attachments, reference text, quick actions |
| `apps/web/components/platform/task-detail/TaskMainContent.tsx` | 166 | Left column: title, description, action buttons, acceptance criteria, ExecutionConsole |
| `apps/web/components/platform/task-detail/ActivityFeed.tsx` | 231 | Events timeline + comments with own query and optimistic addComment mutation |
| `apps/web/components/platform/task-detail/ExecutionConsole.tsx` | 65 | Phase switch: calls getPhase(), renders the matching phase component |
| `apps/web/components/platform/task-detail/StepCard.tsx` | 339 | Step card used by PlanReviewPhase and ExecutionPhase; includes StepInsightsModal, LiveActivityFeed, AgentOutputRenderer |
| `apps/web/components/platform/task-detail/phases/NoPlanPhase.tsx` | 34 | No plan: Generate Plan button or "assign an agent" message |
| `apps/web/components/platform/task-detail/phases/PlanningPhase.tsx` | 51 | Planning in progress: skeleton cards, revising notice |
| `apps/web/components/platform/task-detail/phases/PlanningFailedPhase.tsx` | 63 | Planning failed: error card with retry textarea |
| `apps/web/components/platform/task-detail/phases/ClarificationPhase.tsx` | 70 | Agent questions: numbered list, answer textarea |
| `apps/web/components/platform/task-detail/phases/PlanReviewPhase.tsx` | 50 | Step list with Approve/Request Changes bar |
| `apps/web/components/platform/task-detail/phases/ExecutionPhase.tsx` | 53 | Execution progress: status badge, progress bar, live step cards |
| `apps/web/components/platform/task-detail/phases/ReviewPhase.tsx` | 256 | Receipt: what happened, tools touched, results, assumptions, raw toggle, Mark as Done |
| `apps/web/components/platform/task-detail/agenttaskview.md` | — | This document |

---

## Section 9 — Session fixes (2026-04-29)

### 9.1 — task.step.created WS handler (GlobalTaskStreamProvider.tsx)

**Problem:** The backend (`taskWorker.ts`) streams plan steps one by one via `task.step.created` events at 100 ms intervals after the relay returns the full plan. The frontend had no handler for this event type, so all streamed steps were silently ignored.

**Effect:** During planning, only skeleton cards showed (never real steps animating in). After planning completed, `PlanReviewPhase` rendered with an empty steps array for up to 30 seconds until the polling interval fired.

**Fix:** Added `task.step.created` handler to `GlobalTaskStreamProvider.tsx`. The handler appends the new step to `old.data.steps` in the React Query cache with a deduplication check (`exists` guard) to prevent duplicates when both WS and the 30 s poll fire for the same step.

---

### 9.2 — PlanningPhase animated step reveal (PlanningPhase.tsx + ExecutionConsole.tsx)

**Problem:** `PlanningPhase` always showed 4 static skeleton cards regardless of whether steps had arrived via WS.

**Fix:**
- Added `steps: Step[]` prop to `PlanningPhase`.
- If `steps.length === 0`: renders 4 skeleton cards (agent still thinking).
- If `steps.length > 0`: renders arrived steps with `animate-in fade-in duration-500` + 1 trailing skeleton to indicate more are coming.
- `ExecutionConsole.tsx` updated to pass `steps` to `PlanningPhase`.

When `task.status.changed: awaiting_approval` fires, `ExecutionConsole` switches to `PlanReviewPhase` automatically — no extra logic in `PlanningPhase`.

---

### 9.3 — Structured output rendering in StepCard.tsx

**Problem:** `agentOutput` is a JSON string (`{ summary, results[], reasoning, toolRationale }`). The card was passing it raw to `AgentOutputRenderer` (markdown renderer), producing unreadable JSON-as-text in the result section.

**Fix:**
- `parsedOutput` parsed once at `StepCard` level via IIFE with try/catch. Includes `reasoning`, `toolRationale`, `results[]` (with `company` field), `summary`.
- `resultsExpanded` local state for collapsible sources list.
- Result block now has two branches:
  - **Case 1 (`!step.summary && parsedOutput?.summary`):** renders `parsedOutput.summary` via `renderInlineMarkdown`, plus collapsible sources list (`parsedOutput.results`).
  - **Case 2 (fallback):** existing `AgentOutputRenderer` with `step.summary || step.agentOutput` — unchanged.
- `StepInsightsModal` updated to receive `parsedOutput` as a prop (no longer parses internally — eliminates double-parse).
- Added `extractDomain(url)` and `renderInlineMarkdown(text)` helpers (inline bold, code, links, bare URLs).
- `step.summary` always takes priority — if present, Case 1 never activates.

**Preserved:** `parseEmailEntries` and `AgentOutputRenderer` are untouched fallback path.

---

### 9.4 — Planning-time reasoning saved per step (taskWorker.ts)

**Problem:** `StepInsightsModal` showed "No detailed reasoning provided" for all pending steps. The `reasoning` DB column and `Step.reasoning` frontend type both existed but the relay response type and the insert object never included it.

**Fix (taskWorker.ts only — no frontend changes):**
1. Added `reasoning?: string` to the relay response body type (step array, line ~140).
2. Added `reasoning: step.reasoning ?? null` to the `db.insert(taskSteps)` object.
3. Added `reasoning: taskSteps.reasoning` to the `.returning()` call.
4. Added `reasoning: step.reasoning ?? null` to the `task.step.created` WS event payload.

When the relay starts returning `reasoning` per step, it will be saved to DB and sent to the frontend immediately via the streaming WS event. The modal already reads `step.reasoning` as a fallback — no frontend change needed.

---

### 9.5 — LiveActivityFeed wiped by 5-second polling (TaskDetailView.tsx)

**Problem:** `LiveActivityFeed` in `StepCard` requires `isRunning && (step.liveActivity?.length || step.agentThinking || step.liveText)`. These three fields are synthetic — written by WS events into the React Query cache but never persisted to DB. The `TaskDetailView` polling `useEffect` calls `queryClient.setQueryData(['task', taskId], fresh)` every 5 seconds with the raw API response, which wipes all three fields. The feed appeared invisible during execution.

**Fix (TaskDetailView.tsx — polling useEffect untouched):**
- Added `previousStepsRef: useRef<Record<string, { liveActivity?, liveText?, agentThinking? }>>({})` in the refs block.
- Added `select` function to the `useQuery(['task', taskId])` call. On every cache read (including after every `setQueryData` from the 5 s poll), `select` merges `previousStepsRef.current[step.id]` live fields back into the server-returned step.
- Added a combined `useEffect([steps])` that:
  - Writes to `previousStepsRef.current[step.id]` whenever a step has live fields.
  - Deletes `previousStepsRef.current[step.id]` when a step reaches `done`, `failed`, or `skipped` — prevents stale live data bleeding into future runs.

**Why `select` works here:** TanStack Query applies `select` to the raw cache data on every re-render triggered by `setQueryData`, whether that call came from a WS handler or the polling useEffect. So the merge runs automatically after every poll.

---

### Updated WebSocket cache write table (all handled by GlobalTaskStreamProvider)

| WS event type | Cache mutation | Notes |
|---|---|---|
| `task.step.delta` | Sets `step.liveText = ev.text` | — |
| `task.step.tool_call` | Appends to `step.liveActivity` | — |
| `task.step.tool_result` | Marks last open tool_call completed | — |
| `task.step.thinking` | Sets `step.agentThinking = true` | — |
| `task.step.updated` | Sets status, agentOutput, startedAt/completedAt; clears liveText/liveActivity/agentThinking on terminal status | **live field clear added 2026-04-30** |
| `task.step.created` | Appends new step to steps array (with dedup) | **Added 2026-04-29** |
| `task.status.changed` | Sets `task.status`; invalidates detail cache on `awaiting_approval` | — |
| `task.clarification.requested` | Sets `task.status = 'blocked'`, appends event | — |
| `task.comment.added` | Appends to `['task-comments', taskId]` | — |
