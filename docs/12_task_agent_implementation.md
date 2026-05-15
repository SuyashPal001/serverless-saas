# Task Agent — Phase 3 Implementation Guide

Reference this document at the start of every task agent session.
Read docs/11_roadmap_agent_implementation.md and docs/09_mastra_deep_reference.md
sections 21 and 22 first for architecture context.

---
## Rules — Read Before Writing Any Code

1. NEVER modify platformAgent.ts, taskExecution.ts, prdWorkflow.ts, or roadmapWorkflow.ts
2. NEVER call DB directly from a workflow step — steps are pure content generation only
3. ALWAYS follow the pattern: workflow generates content → agent calls tool → tool writes to DB
4. saveTasks.ts uses raw pg.Pool — same singleton pattern as savePRD.ts and fetchPRD.ts
5. sequence_id on agent_tasks is nullable — do NOT attempt to set it (planService omits it too)
6. acceptance_criteria on agent_tasks is {text, checked}[] — convert from string[] in saveTasks
7. taskWorkflow formatStep output MUST match TaskGenerationData shape exactly
8. NEVER use .network() — use .stream() or .generate()
9. ALWAYS show full file contents after every change
10. ALWAYS redeploy and confirm online status after changes

---
## DB Facts (verified from schema + planService.ts)

- `agent_tasks` INSERT columns: id, tenant_id, created_by, title, description,
  acceptance_criteria, priority, estimated_hours, status, plan_id, milestone_id,
  created_at, updated_at — NO sequence_id, NO type (matches planService batch insert)
- `acceptance_criteria`: jsonb, default `[]`, shape `{text: string, checked: boolean}[]`
- `status` default: `'backlog'::task_status`
- `priority` default: `'medium'::task_priority` — enum: `low|medium|high|urgent`
- `tenant_counters` resource for tasks: `'task'` (defined in pm.ts comment) — but
  planService does NOT set sequence_id for tasks. Phase 3 follows the same pattern.
- `project_milestones.acceptance_criteria`: stored as flat `string[]` by planService

---
## TaskGenerationData Shape — formatStep must output this exactly

```ts
interface TaskItem {
  title: string
  description: string
  acceptanceCriteria: string[]   // tool converts to {text, checked: false}[]
  priority: 'low' | 'medium' | 'high' | 'urgent'
  estimatedHours?: number
}

interface MilestoneTaskData {
  milestoneId: string            // FK into project_milestones.id
  milestoneName: string          // for logging only
  tasks: TaskItem[]              // 2–5 per milestone
}

interface TaskGenerationData {
  planId: string
  milestones: MilestoneTaskData[]
}
```

---
## Phase 3 — What To Build

### Step 1 — skill: skills/task-breakdown/SKILL.md

```markdown
# Task Breakdown SOP

You are a task breakdown specialist. Your input is a project plan with milestones.
Your output is a set of concrete engineering tasks for each milestone.

## What to extract from each milestone
- Milestone title and description → scope of work
- Acceptance criteria → done-criteria for tasks
- Priority → inform task priority weighting

## Task rules
- Each task = one atomic, assignable unit of work (1–8 hours)
- 2–5 tasks per milestone (fewer for simple milestones, more for complex)
- Each task must have:
  - title: action-oriented verb phrase (e.g. "Implement JWT refresh endpoint")
  - description: 1–2 sentences on what to build and why
  - priority: low | medium | high | urgent (match or derive from milestone priority)
  - acceptanceCriteria: 2–3 done-criteria as plain-english strings
  - estimatedHours: realistic 1–8 hour estimate

## Priority rules
- urgent: blocking the milestone, must ship first
- high: core deliverable of the milestone
- medium: important but not the critical path
- low: polish or nice-to-have

## Never do these
- Never invent features not described in the milestone
- Never set all tasks to the same priority
- Never leave acceptanceCriteria empty
- Never generate tasks for all milestones in one pass — process one milestone at a time
```

---
### Step 2 — workspace: src/mastra/workspace/taskWorkspace.ts

Same pattern as roadmapWorkspace.ts — LocalFilesystem pointing to skills/task-breakdown/.

---
### Step 3 — workflow: src/mastra/workflows/taskWorkflow.ts

Three steps — same pattern as roadmapWorkflow.ts:

**analyzeStep**
- Input: `{ planContent: string }` — JSON string of plan + milestones from fetchPlan
- Uses `taskAgent.generate()`
- Prompt: summarize each milestone's scope, priority, and AC to guide task generation
- Output: `{ analysis: string }`

**generateStep**
- Input: `{ analysis: string }`
- Uses `taskAgent.generate()`
- Uses `getInitData()` to access `planContent` for milestone IDs
- Prompt: for each milestone in the plan, generate 2–5 tasks following the task-breakdown SKILL.md
- Output: `{ taskDraft: string }`

**formatStep**
- Input: `{ taskDraft: string }`
- Uses `formatterAgent.generate()` with structuredOutput
- Output: `TaskGenerationData` shape — milestoneId must come from the original plan, never invented

Import taskAgent directly (not via index.ts) to avoid circular dependency.

---
### Step 4 — tool: src/mastra/tools/fetchPlan.ts

- id: `'fetch-plan'`
- Input: `{ planId: string, tenantId: string }`
- Uses raw pg.Pool singleton — same pattern as fetchPRD.ts
- Query:
  ```sql
  SELECT p.id, p.title, p.description, p.status, p.target_date,
         json_agg(json_build_object(
           'id', m.id, 'title', m.title, 'description', m.description,
           'priority', m.priority, 'acceptance_criteria', m.acceptance_criteria,
           'status', m.status
         ) ORDER BY m.created_at) AS milestones
  FROM project_plans p
  LEFT JOIN project_milestones m ON m.plan_id = p.id AND m.deleted_at IS NULL
  WHERE p.id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL
  GROUP BY p.id
  ```
- If not found: return `{ plan: null, reason: 'Plan not found' }`
- If found: return `{ plan: { id, title, description, status, targetDate, milestones[] }, reason: null }`

---
### Step 5 — tool: src/mastra/tools/saveTasks.ts

- id: `'save-tasks'`
- Input:
  - `tenantId: string`
  - `userId: string`
  - `planId: string`
  - `milestones: MilestoneTaskData[]`
- Uses raw pg.Pool
- For each milestone, batch-INSERT tasks into agent_tasks:
  - Convert `acceptanceCriteria: string[]` → `{text, checked: false}[]` before JSON.stringify
  - Do NOT set sequence_id (leave null — matches planService pattern)
  - status: `'backlog'` (hardcoded)
- Output: `{ taskCount: number, milestoneCount: number }`
- Wrap in a transaction — all milestones succeed or none

---
### Step 6 — agent: src/mastra/agents/taskAgent.ts

```ts
import { Agent } from '@mastra/core/agent'
import { saarthiModel } from '../model.js'
import { taskWorkspace } from '../workspace/taskWorkspace.js'
import { taskWorkflow } from '../workflows/taskWorkflow.js'
import { fetchPlan } from '../tools/fetchPlan.js'
import { saveTasks } from '../tools/saveTasks.js'
import { taskCompletenessScorer } from '../scorers/taskCompleteness.js'

export const taskAgent = new Agent({
  id: 'saarthi-task',
  name: 'Saarthi Task',
  description: 'Specialist agent that breaks down an approved project plan into atomic engineering tasks per milestone.',
  instructions: `You are a task breakdown specialist.

Steps to follow every time:
1. Call fetch-plan with the planId from context — if not found, stop and tell the user
2. Run taskWorkflow with the plan content JSON — analyzeStep → generateStep → formatStep
3. Call save-tasks with the formatted TaskGenerationData and userId/tenantId from context
4. Return a summary: plan title, milestones processed, total tasks created

Never generate tasks beyond what the milestones describe.
Never skip fetching the plan — always read it fresh from the DB.`,
  model: saarthiModel,
  workspace: taskWorkspace,
  workflows: { tasks: taskWorkflow },
  tools: { fetchPlan, saveTasks },
  scorers: {
    taskCompleteness: {
      scorer: taskCompletenessScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
})
```

---
### Step 7 — scorer: src/mastra/scorers/taskCompleteness.ts

Same pattern as roadmapCompleteness.ts:
- id: `'task-completeness'`
- REQUIRED_ELEMENTS: `['task', 'priority', 'acceptance', 'hours']`
- generateScore: found/4
- generateReason: one sentence on which required elements were present or missing

---
### Step 8 — update pmAgent.ts

Add taskAgent to agents and add task breakdown intent signals:

```ts
import { taskAgent } from './taskAgent.js'

// inside Agent config:
agents: { prdAgent, roadmapAgent, taskAgent },

// update instructions — update ## When to delegate to taskAgent section:
## When to delegate to taskAgent
- User asks to break down a roadmap, generate tasks, or create a task list
- User says "break into tasks", "generate tasks for plan", "task breakdown"
- Plan must exist and have milestones — if not, tell the user to generate a roadmap first
```

Remove the "(Phase 3 — not yet available)" note from the taskAgent delegation section.

---
### Step 9 — register in index.ts

Add `taskAgent` to agents map and `taskCompletenessScorer` to scorers map.
Do not remove or modify any existing registrations.

```ts
import { taskAgent } from './agents/taskAgent.js'
import { taskCompletenessScorer } from './scorers/taskCompleteness.js'
import { taskWorkflow } from './workflows/taskWorkflow.js'

// agents:
agents: { saarthi: platformAgent, formatter: formatterAgent, prd: prdAgent, pm: pmAgent, roadmap: roadmapAgent, task: taskAgent },

// workflows:
workflows: { ..., tasks: taskWorkflow },

// scorers:
scorers: { ..., taskCompleteness: taskCompletenessScorer },
```
