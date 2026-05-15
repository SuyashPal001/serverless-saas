# Roadmap Agent — Phase 2 Implementation Guide

Reference this document at the start of every roadmap agent implementation
session. Read docs/09_mastra_deep_reference.md sections 21 and 22 and
docs/10_pm_agent_implementation.md first for architecture context.

---
## Rules — Read Before Writing Any Code

1. NEVER modify platformAgent.ts, taskExecution.ts, documentWorkflow.ts, or prdWorkflow.ts
2. NEVER call createPlanFromPrd directly from a workflow step — workflow steps are pure content generation only
3. ALWAYS follow the pattern: workflow generates content → agent calls tool → tool writes to DB
4. savePlan.ts wraps planService.createPlanFromPrd() — do NOT reimplement sequence_id or tenant_counters logic
5. fetchPRD.ts reads from agent_prds using raw pg.Pool — same pattern as savePRD.ts
6. roadmapWorkflow formatStep output MUST match PrdData shape exactly — tasks: [] on every milestone
7. NEVER use .network() — use .stream() or .generate()
8. ALWAYS show full file contents after every change
9. ALWAYS redeploy and confirm online status after changes

---
## PrdData Shape — formatStep must output this exactly

```ts
interface PrdData {
  plan: {
    title: string
    description: string
    targetDate?: string        // ISO string
  }
  milestones: Array<{
    title: string
    description: string
    priority: 'low' | 'medium' | 'high' | 'urgent'
    tasks: []                  // always empty — Phase 3 fills these
  }>
  risks: string[]
  totalEstimatedHours?: number
}
```

acceptance_criteria on project_milestones is string[] — e.g. ["Auth flow complete", "Tests passing"]
The planService handles mapping from milestones description + AC into the DB correctly.

---
## Phase 2 — What To Build

### Step 1 — skill: skills/roadmap-planning/SKILL.md

```markdown
# Roadmap Planning SOP

You are a roadmap planning specialist. Your input is an approved PRD.
Your output is a structured project plan with milestones.

## What to extract from the PRD
- Product/feature name → plan title
- Overall timeline or target date → plan targetDate
- Goals and success metrics → milestone acceptance criteria
- Feature areas or functional requirements → milestones
- Risks mentioned → risks array

## Milestone rules
- Each milestone = one shippable, testable outcome
- 3–7 milestones per roadmap (fewer for simple features, more for complex)
- Each milestone must have:
  - title: short, outcome-focused (e.g. "Authentication flow live")
  - description: 1–2 sentences on what this milestone delivers
  - priority: low | medium | high | urgent
  - acceptance_criteria: 2–4 plain-english done-criteria as string[]
- Milestones must be ordered chronologically
- Target dates must be realistic — spread evenly across the plan timeline

## Priority rules
- urgent: blocking everything else, must ship first
- high: core to the product, ships early
- medium: important but not blocking
- low: nice to have, ships last

## Never do these
- Never generate tasks — that is Phase 3 (taskAgent)
- Never invent features not mentioned in the PRD
- Never set all milestones to the same priority
- Never leave acceptance_criteria empty
```

### Step 2 — workspace: src/mastra/workspace/roadmapWorkspace.ts

Same pattern as prdWorkspace.ts — LocalFilesystem pointing to skills/roadmap-planning/.

### Step 3 — workflow: src/mastra/workflows/roadmapWorkflow.ts

Three steps — same pattern as prdWorkflow.ts:

**analyzeStep**
- Input: { prdContent: string }
- Uses roadmapAgent.generate()
- Prompt: extract plan title, target date, feature areas, goals, risks from PRD content
- Output: { analysis: string }

**planStep**
- Input: { analysis: string, prdContent: string }
- Uses roadmapAgent.generate()
- Prompt: using the analysis, generate 3–7 milestones following the roadmap-planning SKILL.md SOP
- Output: { roadmapDraft: string }

**formatStep**
- Input: { roadmapDraft: string }
- Uses formatterAgent.generate() with structuredOutput
- Output: exact PrdData JSON shape — tasks: [] on every milestone

### Step 4 — tool: src/mastra/tools/fetchPRD.ts

- id: 'fetch-prd'
- Input: { prdId: string, tenantId: string }
- Uses raw pg.Pool — same singleton pattern as savePRD.ts
- Query: SELECT id, title, content, content_type, status FROM agent_prds WHERE id = $1 AND tenant_id = $2
- Output: { id, title, content, contentType, status } | null
- If not found or status !== 'approved': return null with a clear reason string

### Step 5 — tool: src/mastra/tools/savePlan.ts

- id: 'save-plan'
- Input:
  - tenantId: string
  - userId: string
  - prdData: PrdData  ← exact shape above
- Uses raw pg.Pool
- Calls planService.createPlanFromPrd(tenantId, userId, prdData) directly
- Output: { planId: string, sequenceId: number, milestoneCount: number }
- Do NOT reimplement tenant_counters or sequence_id logic — planService handles it

### Step 6 — agent: src/mastra/agents/roadmapAgent.ts

```ts
import { Agent } from '@mastra/core/agent'
import { saarthiModel } from '../model.js'
import { roadmapWorkspace } from '../workspace/roadmapWorkspace.js'
import { roadmapWorkflow } from '../workflows/roadmapWorkflow.js'
import { fetchPRD } from '../tools/fetchPRD.js'
import { savePlan } from '../tools/savePlan.js'
import { roadmapCompletenessScorer } from '../scorers/roadmapCompleteness.js'

export const roadmapAgent = new Agent({
  id: 'saarthi-roadmap',
  name: 'Saarthi Roadmap',
  description: 'Specialist agent that generates a structured project plan with milestones from an approved PRD.',
  instructions: `You are a roadmap planning specialist.

Steps to follow every time:
1. Call fetch-prd with the prdId from context — if status is not approved, stop and tell the user
2. Run roadmapWorkflow with the PRD content — analyzeStep → planStep → formatStep
3. Call save-plan with the formatted PrdData output and userId/tenantId from context
4. Return a summary: plan title, PLN-{sequenceId}, number of milestones created, target date

Never generate tasks — that is Phase 3.
Never skip fetching the PRD — always read it fresh from the DB.`,
  model: saarthiModel,
  workspace: roadmapWorkspace,
  workflows: { roadmap: roadmapWorkflow },
  tools: { fetchPRD, savePlan },
  scorers: {
    roadmapCompleteness: {
      scorer: roadmapCompletenessScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
})
```

### Step 7 — scorer: src/mastra/scorers/roadmapCompleteness.ts

Same pattern as prdCompleteness.ts:
- id: 'roadmap-completeness'
- generateScore: check if output contains all of: 'milestone', 'priority', 'target', 'acceptance' — return found/4
- generateReason: one sentence on which required elements were present or missing

### Step 8 — update pmAgent.ts

Add roadmapAgent to agents and add roadmap intent signals:

```ts
import { roadmapAgent } from './roadmapAgent.js'

// inside Agent config:
agents: { prdAgent, roadmapAgent },

// update instructions — add to ## When to delegate section:
## When to delegate to roadmapAgent
- User asks to generate, create, or build a roadmap
- User says "roadmap from PRD", "create a plan", "generate milestones"
- PRD status must be approved — if not, tell the user to approve the PRD first
```

### Step 9 — update chatStream.ts

Add userId to requestContext — find where tenantId and agentId are set and add:
```ts
requestContext.set('userId', internalUserId)
```

### Step 10 — register in index.ts

Add roadmapAgent to agents map and roadmapCompletenessScorer to scorers map.
Do not remove or modify any existing registrations.

---
## Phase 3 — Preview (Do Not Build Yet)

- taskAgent reads approved project_milestones
- Generates agent_tasks with acceptance_criteria: { text, checked: false }[]
- Links tasks via milestone_id and plan_id FKs
- taskWorkflow: analyzeStep → generateStep → formatStep (same pattern)
