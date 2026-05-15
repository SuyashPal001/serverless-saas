# PM Agent — Phase 1 Implementation Guide

**Phase 1 status: COMPLETE — committed 5b06319**

Reference this document at the start of every PM agent implementation
session. Read docs/09_mastra_deep_reference.md sections 21 and 22
first for architecture context.

---
## Rules — Read Before Writing Any Code

0. FILE LENGTH — every file created or edited must stay within 300 lines.
   Target 100–200 lines. Split into smaller modules if needed. Hard ceiling.
1. NEVER modify platformAgent.ts tools, memory, or model config
2. NEVER modify taskExecution.ts or documentWorkflow.ts
3. NEVER modify prdWorkflow.ts unless explicitly instructed
4. ALWAYS follow the tree in section 21 of 09_mastra_deep_reference.md
5. ALWAYS import agents directly from their own files, not from index.ts
   (prevents circular imports)
6. NEVER use .network() — it is deprecated. Use .stream() or .generate()
7. NEW tools go in src/mastra/tools/ as separate files, not in tools.ts
8. ALWAYS show full file contents after every change
9. ALWAYS redeploy after changes and confirm online status

---
## Phase 1 — Build Status

| Step | What | Status |
|---|---|---|
| 1 | DB migration — `agent_prds` table | ✅ Done — migration 0023, live in Neon |
| 2 | Tool: `fetchAgentContext` | ✅ Done — `src/mastra/tools/fetchAgentContext.ts` |
| 3 | Tool: `savePRD` | ✅ Done — `src/mastra/tools/savePRD.ts` |
| 4 | `pmAgent.ts` | ⬜ Next |
| 5 | Register in `index.ts` | ⬜ Pending |
| 6 | `chatStream.ts` routing | ⬜ Pending |

---
## Phase 1 — What To Build

### Step 1 — DB Migration: agent_prds table ✅

Create a new Drizzle migration for the agent_prds table:

```sql
id                    uuid primary key default gen_random_uuid()
tenant_id             uuid not null references tenants(id)
agent_id              uuid not null references agents(id)
title                 varchar not null
content               text not null
content_type          varchar not null default 'markdown'
status                varchar not null default 'draft'
version               integer not null default 1
created_from_task_ids uuid[]
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

Status values: draft | pending_approval | approved | rejected
Content type values: markdown | html

### Step 2 — Tool: fetchAgentContext ✅

File: src/mastra/tools/fetchAgentContext.ts

Purpose: fetch product/company context for a tenant by calling
the existing /internal/retrieve Lambda endpoint (same pattern
as existing RAG calls in the codebase).

Input schema:
- agentId: string
- tenantId: string
- query: string  ← what context to retrieve

Output schema:
- context: string  ← retrieved chunks joined as text
- sourceCount: number

### Step 3 — Tool: savePRD ✅

File: src/mastra/tools/savePRD.ts

Purpose: save or update a PRD draft to the agent_prds table.

Input schema:
- agentId: string
- tenantId: string
- title: string
- content: string
- contentType: 'markdown' | 'html'
- existingPrdId?: string  ← if set, update and increment version

Output schema:
- prdId: string
- version: number
- status: string

Logic:
- If existingPrdId provided → UPDATE content, increment version
- If no existingPrdId → INSERT new row with status: draft

### Step 4 — pmAgent

File: src/mastra/agents/pmAgent.ts

```ts
import { Agent } from '@mastra/core/agent'
import { saarthiModel } from '../model.js'
import { getMastraMemory } from '../memory.js'
import { prdAgent } from './prdAgent.js'
import { formatterAgent } from './formatterAgent.js'
import { prdWorkflow } from '../workflows/prdWorkflow.js'
import { fetchAgentContext } from '../tools/fetchAgentContext.js'

export const pmAgent = new Agent({
  id: 'saarthi-pm',
  name: 'Saarthi PM',
  description: 'Supervisor agent that orchestrates PRD generation, roadmap planning, and task breakdown by delegating to specialist agents.',
  instructions: `You are a product management supervisor. Your job is to understand what the user needs and delegate to the right specialist agent.

Available specialists:
- prdAgent: use when user wants to create, refine, or work on a PRD
- roadmapAgent: use when user wants to plan a roadmap from an approved PRD (not available yet)
- taskAgent: use when user wants to break a roadmap into tasks (not available yet)

Rules:
- Never generate PRD content yourself — always delegate to prdAgent
- Ask clarifying questions before delegating if the request is vague
- After prdAgent completes, summarize what was produced and ask if the user wants to refine or submit for approval`,
  model: saarthiModel,
  memory: getMastraMemory(),
  agents: { prdAgent },
  workflows: { prdWorkflow },
  tools: { fetchAgentContext },
})
```

### Step 5 — Register pmAgent in index.ts

Add pmAgent to the agents map in src/mastra/index.ts.
Do not remove any existing agents.

### Step 6 — chatStream.ts Routing

Add PM intent detection before the existing platformAgent.stream() call.

PM intent signals (route to pmAgent):
- "create a prd"
- "write a prd"
- "product requirements"
- "prd for"
- "requirements document"
- "i need a prd"

If PM intent detected:
```ts
const skill = await fetchAgentSkill(agentId)
if (skill?.systemPrompt) {
  requestContext.set('agentSystemPrompt', skill.systemPrompt)
}

// Load existing PRD draft if any
const existingPrd = await fetchPRDDraft(agentId, tenantId)
if (existingPrd) {
  requestContext.set('existingPrdDraft', existingPrd.content)
  requestContext.set('existingPrdId', existingPrd.id)
}

const stream = await pmAgent.stream(userMessage, {
  maxSteps: 10,
  requestContext,
})
```

Otherwise fall through to existing platformAgent.stream() call.

---
## Known Issues & Workarounds

### tsc OOM — relay build (fixed)

`tsc` crashed with JavaScript heap out of memory because `@mastra/core`
ships 580 `.d.ts` files (52MB). tsc loads all of them even with `--noCheck`.

**Fix applied (May 15, 2026):**
- `apps/relay/build.mjs` — esbuild build script, compiles all `src/**/*.ts`
  to `dist/` with ESM + source maps, `bundle: false` preserves file structure
- `package.json` `build` script changed from `tsc` → `node build.mjs`
- `type-check` script added: `tsc --noEmit` for CI/manual type checking

**Build rule going forward:**
```bash
cd apps/relay && npm run build && pm2 restart agent-relay
```

This is the same command as before — just faster and no longer OOMs.

### Drizzle migration snapshot drift

Generated migrations may include `ALTER TABLE` statements for columns
that already exist in Neon (snapshot out of sync with live DB).

**Fix:** Edit the generated `.sql` file to remove the offending `ALTER TABLE`
lines before running `pnpm db:migrate`. The new table/enum/index statements
are always safe to keep.

**How to identify drift:** Migration fails with:
```
error: column "X" of relation "Y" already exists
```

---
## Phase 2 — Preview (Do Not Build Yet)

- roadmapAgent.ts
- roadmapWorkspace.ts (skills/roadmap-planning/SKILL.md)
- roadmapWorkflow.ts
- scorers/roadmapCompleteness.ts
- Triggered when agent_prds.status = 'approved'

---
## Phase 3 — Preview (Do Not Build Yet)

- taskAgent.ts
- taskWorkspace.ts (skills/task-breakdown/SKILL.md)
- taskWorkflow.ts
- scorers/taskClarity.ts
- Triggered when agent_roadmaps.status = 'approved'
