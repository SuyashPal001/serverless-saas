# Mastra Integration
**Last Updated:** May 2026
**Commits:**
- 9a46dea — Mastra task executor (initial)
- 9238a58 — per-tenant MCPClient isolation fix
**Status:** Shipped — behind `USE_MASTRA_TASKS` feature flag
**License:** Apache 2.0

---

## Why Mastra Was Adopted

### Decision Log

**The problem:** OpenClaw task execution had three performance problems:
1. ~80 second container spin-up for new tenants (Docker provisioning)
2. New WebSocket connection per task step
3. New MCP connection per step (tool reconnect overhead)

**New tenant first task time: ~95 seconds** — user was staring at a spinner for 1.5 minutes before the agent did anything.

**Original plan:** LangGraph (Python) for multi-agent task orchestration. Relay calls Python ai-service → LangGraph runs tasks.

**Why LangGraph was rejected:**
- New language boundary (Python service in TypeScript codebase)
- New PM2 process on GCP VM to manage
- New HTTP service boundary for every task execution
- Same orchestration capability available in TypeScript via Mastra
- No new infrastructure needed with Mastra

**Mastra adoption decision:**
- TypeScript — same language as relay, same codebase
- Runs inside relay process — no new PM2 service
- `@mastra/core` handles agent loop, memory, tool calling
- `@mastra/pg` stores state in existing Neon database (`mastra` schema)
- `@mastra/mcp` connects to existing mcp-server via SSE
- Apache 2.0 license — OSS features available without enterprise cost

---

## What Mastra Replaces

| Replaced | With | Notes |
|---|---|---|
| LangGraph (Python) task orchestration | Mastra workflow engine | TypeScript, in-process |
| Per-step OpenClaw container spin-up | In-process Mastra agent | 80s → 0s |
| Per-step WebSocket connection | Persistent agent instance | Eliminated |
| Per-step MCP reconnect | Persistent MCPClient | Eliminated |
| Regex-based step done detection | Structured `status` field | Zod-enforced |
| Custom working memory (not built) | `mastra_resources.workingMemory` | Automatic |

## What Mastra Does NOT Replace

| Kept | Why |
|---|---|
| OpenClaw — chat surface | Chat works well. No reason to change. |
| OpenClaw — task planning | Planning still uses OpenClaw + taskWorker |
| OpenClaw — task execution (default) | Default path unchanged. Mastra is opt-in. |
| `apps/relay/src/rag/` | TypeScript RAG is Phase 1 hardened. Stays in TS. |
| `apps/relay/src/pii-filter.ts` | Indian PII patterns are better here than any framework |
| `apps/worker/src/handlers/evalAuto.ts` | Keep until golden dataset proves Mastra path better |

---

## File Structure

```
apps/relay/src/mastra/
├── memory.ts      — PostgresStore (Neon, mastra schema)
├── tools.ts       — MCPClient (persistent SSE to mcp-server:3002)
├── agent.ts       — per-tenant Mastra Agent factory
├── workflow.ts    — task step coordinator + WorkflowContext
└── index.ts       — module exports

Wired into:
apps/relay/src/app.ts
  ├── runMastraTaskSteps()   — new function above runTaskSteps()
  └── POST /api/tasks/execute — USE_MASTRA_TASKS flag branch
```

---

## How It Works

### Execution flow

```
POST /api/tasks/execute (app.ts)
    ↓
USE_MASTRA_TASKS === 'true'?
    ↓ yes
runMastraTaskSteps(taskId, agentId, tenantId, steps, ...)
    ├── checkMessageQuota(tenantId)  — quota guard
    ├── fetchAgentSkill(agentId)     — get instructions from agent_skills
    └── build WorkflowContext
            ├── agentSlug = agentId  (fetchAgentSlug returns agentId unchanged)
            ├── instructions = skill.systemPrompt ?? fallback
            ├── steps mapped: stepOrder → stepNumber
            ├── onStepComplete → callInternalTaskApi /complete
            ├── onStepFail → postTaskComment + /fail
            └── onTaskComment → postTaskComment + /clarify
    ↓
runMastraWorkflow(ctx)  (workflow.ts)
    ├── createTenantAgent(config)  (agent.ts)
    │       ├── getMastraStore()                    — PostgresStore
    │       ├── getMCPClientForTenant(tenantId)      — new MCPClient per task
    │       │       headers: x-internal-service-key + x-tenant-id: tenantId
    │       ├── new Memory(...)                      — working + episodic memory
    │       ├── tools = mcpClient.listTools()
    │       └── new Agent({ id, instructions, model, memory, tools })
    └── for each step (sorted by stepNumber):
            agent.generate(prompt, {
              memory: { thread: 'task:id:step:n', resource: tenantId },
              structuredOutput: { schema: StepOutputSchema },
            })
            → result.object: { status, summary, reasoning, toolCalled, toolResult }
            → onStepComplete / onTaskComment / onStepFail based on status
```

### Step output schema

```typescript
{
  stepId: string,
  status: 'done' | 'needs_clarification' | 'failed',
  summary: string,          // what the agent did or found
  reasoning?: string,       // why it did it this way
  question?: string,        // only if needs_clarification
  toolCalled?: string,      // tool name if used
  toolResult?: unknown,     // result summary if tool was used
}
```

This schema is enforced by Zod via Mastra `structuredOutput`. The LLM cannot return prose — it must match this shape.

---

## Feature Flag

```bash
# apps/relay/.env

# Set to 'true' to use Mastra agent for task step execution
# Default: unset or 'false' — uses OpenClaw path (unchanged)
USE_MASTRA_TASKS=

# Required when USE_MASTRA_TASKS=true:
VERTEX_PROXY_URL=http://localhost:4001/v1
GEMINI_API_KEY=placeholder    # vertex-proxy handles actual auth
MCP_SERVER_HTTP_URL=http://localhost:3002/mcp
```

**The flag is safe to flip in production.** Both paths:
- Call the same Lambda internal callbacks
- Write the same data to the database
- Use the same quota checking
- Pass through the same PII filtering (done before either path runs)

---

## Installed Packages

All added to `apps/relay/package.json`:

| Package | Version | Purpose |
|---|---|---|
| `@mastra/core` | 1.32.1 | Agent, Memory base, workflow primitives |
| `@mastra/pg` | 1.10.0 | PostgresStore — Neon backend |
| `@mastra/mcp` | 1.7.0 | MCPClient — persistent SSE to mcp-server |
| `@mastra/memory` | 1.17.5 | Concrete Memory class (working + episodic) |
| `@ai-sdk/google` | 3.0.67 | Gemini provider with custom baseURL support |

---

## Mastra Tables in Neon

All 33 Mastra tables use the `mastra_` prefix and live in the `mastra` schema. Zero collision with application tables.

**Tables you may need to query:**

| Table | Purpose |
|---|---|
| `mastra_threads` | Conversation threads (one per task+step) |
| `mastra_messages` | Messages within threads |
| `mastra_resources` | Working memory per tenant |
| `mastra_ai_spans` | Execution traces (wire to Langfuse in Phase 2) |
| `mastra_schedules` | Scheduled workflow execution |
| `mastra_agent_versions` | Agent versioning |
| `mastra_scorers` | Eval scorers |
| `mastra_experiments` | Eval experiments |

**Never delete or alter Mastra tables manually.** They are managed by `@mastra/pg` DDL.

---

## Correct API Shapes (Verified from Installed Types)

These were verified by reading actual installed package type definitions — not docs.

```typescript
// ❌ WRONG — abstract class, cannot instantiate
import { Memory } from '@mastra/core/memory'

// ✅ CORRECT — concrete class
import { Memory } from '@mastra/memory'

// ❌ WRONG — Agent missing required id field
new Agent({ name, instructions, model })

// ✅ CORRECT
new Agent({ id: 'unique-id', name, instructions, model })

// ❌ WRONG — google() only takes model ID, no baseURL option
import { google } from '@ai-sdk/google'
google('gemini-2.0-flash', { baseURL: '...' })

// ✅ CORRECT — provider-level baseURL
import { createGoogleGenerativeAI } from '@ai-sdk/google'
const customGoogle = createGoogleGenerativeAI({ baseURL, apiKey })
customGoogle('gemini-2.0-flash')

// ❌ WRONG — deprecated options (not in AgentExecutionOptionsBase)
agent.generate(prompt, { threadId: '...', resourceId: '...' })
agent.generate(prompt, { output: schema })

// ✅ CORRECT
agent.generate(prompt, {
  memory: { thread: 'task:id:step:n', resource: 'tenantId' },
  structuredOutput: { schema: ZodSchema },
})

// ❌ WRONG — method doesn't exist on MCPClient
await client.getToolsets()

// ✅ CORRECT
await client.listTools()      // flat Record<string, Tool> — use for Agent tools field
await client.listToolsets()   // nested — use for display/debugging

// ❌ WRONG — PostgresStore missing required id field
new PostgresStore({ pool, schemaName: 'mastra' })

// ✅ CORRECT
new PostgresStore({ id: 'mastra-pg-store', pool, schemaName: 'mastra' })
```

---

## How to Test Mastra Path Locally

**Prerequisites:** Local Neon database (or `docker-compose up -d`), mcp-server running on :3002, vertex-proxy on :4001.

```bash
# 1. Set env in apps/relay/.env
USE_MASTRA_TASKS=true
VERTEX_PROXY_URL=http://localhost:4001/v1
GEMINI_API_KEY=placeholder
MCP_SERVER_HTTP_URL=http://localhost:3002/mcp
DATABASE_URL=your_neon_url

# 2. Start relay
cd apps/relay && npm run dev

# 3. Create a task through the UI or POST directly:
curl -X POST http://localhost:3001/api/tasks/execute \
  -H 'Content-Type: application/json' \
  -H 'x-internal-service-key: your_key' \
  -d '{
    "taskId": "test-task-id",
    "agentId": "your-agent-id",
    "tenantId": "48070bc4-e2de-4051-960d-9b72d9a0d2bf",
    "steps": [{ "id": "step-1", "stepOrder": 1, "title": "Test step", "description": "Do a test" }],
    "taskTitle": "Test task",
    "taskDescription": "Testing Mastra path"
  }'

# 4. Check logs
pm2 logs agent-relay --lines 50 --nostream
# Look for: [mastra] tenantId=... taskId=... lines
```

---

## How to Enable in Production

```bash
# On GCP VM:

# 1. Ensure relay is on latest develop commit
cd /home/suyashresearchwork/serverless-saas && git pull
cd apps/relay && npm run build

# 2. Add to apps/relay/.env (create if doesn't exist):
USE_MASTRA_TASKS=true
VERTEX_PROXY_URL=http://localhost:4001/v1
GEMINI_API_KEY=placeholder
MCP_SERVER_HTTP_URL=http://localhost:3002/mcp

# 3. Restart relay
pm2 restart agent-relay

# 4. Verify in logs:
pm2 logs agent-relay --lines 20 --nostream
# Should see Mastra startup logs, no errors
```

**To roll back:** Set `USE_MASTRA_TASKS=false` and `pm2 restart agent-relay`. OpenClaw path is identical to pre-Phase-2.

---

## Performance Comparison

| Metric | OpenClaw | Mastra |
|---|---|---|
| Container spin-up (new tenant) | ~80 seconds | 0 seconds (in-process) |
| Per-step overhead | ~500ms | ~55ms |
| MCP connection | New per step | Persistent |
| WebSocket handshake | New per step | None |
| New tenant first task (total) | ~95 seconds | ~12 seconds |
| Memory persistence | Container lifetime | DB-backed (survives restarts) |
| Working memory | Not available | mastra_resources.workingMemory |

---

## Tenant Isolation — MCPClient Fix (9238a58)

### The Bug

Original `tools.ts` had a module-level singleton:
```typescript
let mcpClient: MCPClient | null = null  // ← WRONG
```

This meant:
1. All tenants shared one SSE connection to mcp-server
2. No `x-tenant-id` header — mcp-server could not scope tool credentials to correct tenant
3. Tenant A's task could use Tenant B's OAuth credentials for Gmail/Drive/Jira

### The Fix

`getMCPClientForTenant(tenantId)` creates a new MCPClient instance per task execution:

```typescript
export function getMCPClientForTenant(tenantId: string): MCPClient {
  return new MCPClient({
    servers: {
      saarthiTools: {
        url: new URL(process.env.MCP_SERVER_HTTP_URL ?? 'http://localhost:3002/mcp'),
        requestInit: {
          headers: {
            'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY ?? '',
            'x-tenant-id': tenantId,  // ← credential scoping
          },
        },
      },
    },
  })
}
```

### MCPClient Lifecycle

`createTenantAgent()` returns `TenantAgentWithClient`:
```typescript
export interface TenantAgentWithClient {
  agent: Agent
  mcpClient: MCPClient
}
```

`runMastraWorkflow()` disconnects the client in `try/finally`:
```typescript
const { agent, mcpClient } = await createTenantAgent(agentConfig)
try {
  // step execution loop
} finally {
  await mcpClient.disconnect()  // always called — normal, clarification, fail, throw
}
```

`disconnect(): Promise<void>` confirmed from installed types at `@mastra/mcp/dist/client/client.d.ts:125`.

---

## IDENTITY.md vs SOUL.md — What Mastra Receives

OpenClaw (chat path) reads two separate files per agent:
- `IDENTITY.md` — written from `agent_skills.system_prompt` at container provision time
- `SOUL.md` — static template with RAG query rewriting strategy

**Mastra (task path) only uses `agent_skills.system_prompt`** — fetched at runtime via `fetchAgentSkill(agentId)`. This is the same content as `IDENTITY.md` (full personality + all 25 tool descriptions + behavioral rules).

**SOUL.md integration — parked (Phase 3+):** SOUL.md adds RAG query rewriting guidance. On the Mastra task path, the agent calls `retrieve_documents` via MCP tool directly — the SOUL.md RAG guidance is not applicable. Revisit if RAG migrates to Python ai-service in Phase 3.

**IDENTITY.md filesystem path:** `/opt/tenants/{tenantId}/{agentSlug}/workspace/IDENTITY.md`

---

## What Existing Code Is Kept Alongside Mastra

| File | Kept? | Reason |
|---|---|---|
| `apps/relay/src/openclaw.ts` | ✅ Permanent | Chat path uses OpenClaw permanently |
| `apps/relay/src/app.ts:runTaskSteps()` | ✅ Permanent | Default path — not removed |
| `apps/relay/src/rag/` | ✅ Permanent | Phase 1 hardened — no reason to replace |
| `apps/relay/src/pii-filter.ts` | ✅ Permanent | Indian PII patterns — better than any framework for our market |
| `apps/worker/src/handlers/evalAuto.ts` | ✅ Keep | Replace only when golden dataset proves Mastra better |

---

## Future Migration Path

### When to move production traffic to Mastra

After `USE_MASTRA_TASKS=true` runs in production for one sprint:
- Compare task success rates: Mastra vs OpenClaw
- Compare latency: Mastra vs OpenClaw
- Compare cost: same Gemini model, compare token usage

If Mastra is better or equal on all metrics → make Mastra the default (flip default to `true`).

### When to wire mastra_ai_spans

Phase 2 — after Mastra path is default. Wire to Langfuse for distributed tracing.

### When to wire mastra_schedules to agentWorkflows

Phase 2 — `agentWorkflows` table has `trigger = 'scheduled'`. Wire EventBridge → worker → Mastra to execute scheduled workflows.

### When to consider Mastra for multi-agent

Phase 3 — after first product launch. Real product reveals what orchestration patterns matter before building intent classifier + multi-agent routing.

---

---

## ADR: Mastra Proper Orchestrator Adoption

**Status:** Approved — implementing now

### Context

We have been using `@mastra/core` as a library only — creating `Agent`, `Memory`, `MCPClient` fresh per request and discarding them. No Mastra orchestrator. No observability. No Studio visibility. No evals.

### Decision

Refactor relay to use Mastra as a proper orchestrator:

- `new Mastra({ storage, agents, observability })`
- One platform-level Agent at startup
- Dynamic tools via `requestContext` per tenant
- Dynamic instructions via `requestContext`
- Memory isolation via `MASTRA_RESOURCE_ID_KEY`
- Mount `@mastra/hono` Studio for platform admin

### What We Gain

- **Full observability** — OTel spans per tool call, model latency, token counts
- **Mastra Studio** — connected to real system, real traces, real memory browser
- **Evals/Scorers** — output quality measurement
- **Prompt versioning** — no code deploy needed
- **Agent versioning** — A/B test prompts
- **One agent instance** — not recreated per request
- **Memory isolation** — enforced at framework level

### What Stays the Same

- JWT, PII, billing middleware — untouched
- RAG injection — untouched
- Tool governance — untouched
- Step execution loop in `workflow.ts` — untouched
- All non-Mastra routes — untouched
- vertex-proxy routing — untouched
- OpenClaw chat path — untouched

### What Changes

- `apps/relay/src/mastra/agent.ts` — main refactor
- `apps/relay/src/mastra/memory.ts` — minor
- `apps/relay/src/mastra/index.ts` — new singleton export
- MCPClient disconnect moves to RequestContext pattern

### Risk Areas

- **MCPClient disconnect ownership** — needs wrapper pattern; singleton agent can't own per-request client lifecycle
- **vertex-proxy model not visible in Studio picker** — acceptable, keep custom `createGoogleGenerativeAI({ baseURL })` routing
- **`USE_MASTRA_TASKS` flag** — preserve deliberately; both paths must remain functional

### OpenClaw Retirement

- Chat path stays on OpenClaw permanently
- Task path moves to proper Mastra orchestrator
- OpenClaw task path retired when Mastra validated in production

---

## License

Mastra is **Apache 2.0** for all OSS features. This includes:
- Agent execution
- Memory (working + episodic)
- MCP integration
- PostgresStore
- Workflows
- Observability (mastra_ai_spans)

**Enterprise license required for:**
- RBAC and audit logs (Mastra-level, not our own)
- Dedicated support SLAs
- White-label deployments

For our use case, all features we use are Apache 2.0. No enterprise license needed.
