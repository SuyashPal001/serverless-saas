# Engineer Onboarding — Platform OS
**Last Updated:** May 2026 — Phase 2 Mastra integration
**Purpose:** Every engineer building on this platform needs this context

---

## What This Is

This is not a product. It is an **operating system for agentic products**.

Our team builds products on top of it. Proven products are eventually opened to other businesses. The OS is the constant. Products are the variable.

Think: Shopify is the OS. Stores are the products. We are building Shopify for agentic AI.

---

## What You Are Building On

A multi-tenant agentic platform with two product surfaces:

1. **Chat** — SSE/WebSocket streaming chat. Tenant uploads docs. Users ask questions. Agent answers with citations from knowledge base.

2. **Task Board** — Agentic task execution. User creates task. Agent plans steps. Human approves plan. Agent executes step by step. Human reviews output.

Both surfaces share the same underlying infrastructure but have different quality requirements and failure modes.

---

## The Three Machines

| Machine | What runs there | Your role |
|---|---|---|
| Mac | Development, Claude Code | Write code here |
| Linux VM | SAM builds, Lambda deploys | Deploy Lambda changes here |
| GCP VM | OpenClaw, relay, MCP, agent-server, vertex-proxy | Deploy GCP services here |

**Never deploy directly from Mac to production. Never edit files on GCP VM directly.**

---

## Service Map

```
Your browser
    │
    ├── https://agent-saas.fitnearn.com
    │       → NGINX → Next.js frontend (:3000)
    │       → NGINX → agent-relay (:3001)
    │
    └── Lambda API
            https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com

GCP VM services (pm2 list):
  agent-relay    :3001  ← your primary service (chat + task)
  mcp-server     :3002  ← tool integrations (25 tools)
  agent-server   :3003  ← container provisioning (chat path)
  vertex-proxy   :4001  ← LLM translation layer
  openclaw-src   :18790 ← agent runtime (chat path only)
  web-frontend   :3000  ← Next.js build

Mastra runs INSIDE agent-relay — no separate service or port.
```

---

## The Code

Everything is in the monorepo: `serverless-saas/`

```
apps/
  api/          — Lambda REST API. Your CRUD routes live here.
  worker/       — SQS consumer. Task execution worker lives here.
  web/          — Next.js frontend.
  relay/        — Agent relay SOURCE (deployed to GCP VM from git)
    src/
      mastra/   — Mastra task executor (Phase 2)
        memory.ts     — PostgresStore → Neon (mastra schema)
        tools.ts      — MCPClient → mcp-server:3002
        agent.ts      — per-tenant Mastra Agent
        workflow.ts   — task step coordinator
        index.ts      — module exports
      rag/          — RAG pipeline (stays in TypeScript)
      pii-filter.ts — Indian PII patterns (permanent)
      app.ts        — HTTP routes including task execution
      index.ts      — WebSocket/SSE chat handling
  mcp-server/   — MCP gateway SOURCE
  agent-server/ — Container provisioning SOURCE
  vertex-proxy/ — LLM proxy SOURCE

packages/foundation/
  auth/         — JWT verification, Cognito
  database/     — Drizzle schema, all DB tables
  entitlements/ — Plan limits, quota checking
  cache/        — Redis
  storage/      — S3
  types/        — Shared TypeScript types
```

**Important:** GCP VM services pull source from git. `apps/relay/` in the monorepo is the source. The running instance on the VM should always match the latest commit on `develop`.

---

## The Database

**Neon (serverless Postgres)** — `serverless-saas/dev/database` in AWS Secrets Manager.

**Application tables (Drizzle schema):**
- `agent_tasks` — task board tasks
- `task_steps` — steps within a task
- `task_events` — audit log of task state changes
- `agents` — agent definitions per tenant
- `agent_skills` — system prompts, tool configs per agent
- `conversations` — chat sessions
- `messages` — chat messages
- `files` — uploaded files with S3 keys
- `document_chunks` — RAG chunks with vector embeddings
- `usage_records` — token usage per tenant
- `integrations` — OAuth credentials per tenant (encrypted)

**Mastra tables (mastra schema — all prefixed `mastra_`):**
- `mastra_threads` — conversation threads per task/step
- `mastra_messages` — messages within threads
- `mastra_resources` — working memory per tenant (resourceId = tenantId)
- `mastra_ai_spans` — execution traces
- `mastra_schedules` — scheduled workflow execution
- Plus ~28 more internal Mastra tables

**Zero collision:** Application tables use no `mastra_` prefix. Mastra tables are in the `mastra` schema. They share the same Neon database but are completely separate.

Never write raw SQL. Use Drizzle ORM for application tables. Mastra tables are managed by `@mastra/pg` — do not touch them manually.

---

## The Two Task Execution Paths

### Current default: OpenClaw path

```
POST /api/tasks/execute
    ↓
runTaskSteps() in app.ts
    ↓
Per-step: agent-server provisions OpenClaw container
    ↓
Relay sends step prompt via WebSocket → OpenClaw
    ↓
OpenClaw reasons → calls tools → returns structured output
    ↓
callInternalTaskApi() → Lambda /internal/tasks/{id}/steps/{stepId}/complete
```

**Problems with OpenClaw for tasks:**
- ~80 second container spin-up for new tenants
- New WebSocket connection per step
- Per-step MCP reconnect overhead

### Phase 2: Mastra path (USE_MASTRA_TASKS=true)

```
POST /api/tasks/execute
    ↓
runMastraTaskSteps() in app.ts
    ↓
fetchAgentSkill(agentId) → get instructions from agent_skills
    ↓
WorkflowContext built with callbacks → runMastraWorkflow()
    ↓
Per-step: Mastra agent.generate() with structuredOutput schema
    ↓
Zod-validated output: { status, summary, reasoning, toolCalled, toolResult }
    ↓
onStepComplete/onStepFail/onTaskComment → callInternalTaskApi()
```

**Improvement:**
- 0s container spin-up (in-process)
- Persistent MCP connection
- Structured output enforced by Zod schema
- Working memory persists between tasks for same tenant

### Feature flag

```bash
# apps/relay/.env on GCP VM

USE_MASTRA_TASKS=false   # default — OpenClaw path
USE_MASTRA_TASKS=true    # Mastra path
```

Both paths call the same Lambda internal callbacks. Output to the database is identical. The flag is safe to flip.

---

## The Task Board Flow (Planning)

Planning always uses OpenClaw — Mastra is only for execution:

```
User creates task
    ↓
API route → SQS message (plan_task)
    ↓
taskWorker Lambda picks up message
    ↓
Worker calls relay POST /api/tasks/plan
    ↓
Relay builds planning prompt → sends to OpenClaw → gets JSON step plan
    ↓
Steps inserted to DB → task status = awaiting_approval
    ↓
Frontend shows plan to user for approval
    ↓
User approves → SQS message (execute_task)
    ↓
taskWorker calls relay POST /api/tasks/execute
    ↓
Relay runs each step via OpenClaw OR Mastra (feature flag)
    ↓
Each step: complete or needs_clarification or failed
    ↓
Task status = review → user reviews → done or feedback
```

---

## The Chat Flow

```
User sends message
    ↓
Frontend → WebSocket/SSE → NGINX → relay :3001
    ↓
Relay verifies Cognito JWT
    ↓
Relay provisions OpenClaw container (agent-server)
    ↓
Relay fetches conversation history from DB
    ↓
Relay fetches RAG context (retrieve_documents)
    ↓
Relay builds: [system] + [history] + [RAG] + [new message]
    ↓
Relay → OpenClaw WebSocket → streams response
    ↓
Relay saves messages to DB (fire-and-forget)
    ↓
Relay fires eval metrics (fire-and-forget)
```

**Chat path always uses OpenClaw.** Mastra is task-only.

---

## Mastra API — Correct Shapes (Verified from Installed Types)

If you are editing `apps/relay/src/mastra/`, use these exact shapes:

```typescript
// Memory — import from @mastra/memory (NOT @mastra/core/memory)
import { Memory } from '@mastra/memory'
new Memory({
  storage: store,              // PostgresStore instance
  options: {
    lastMessages: 20,
    semanticRecall: false,     // no vector store in memory
    workingMemory: { enabled: true },
  },
})

// Agent — requires `id` field
import { Agent } from '@mastra/core/agent'
new Agent({
  id: 'saarthi-slug-tenantId',  // REQUIRED — missing = type error
  name: 'saarthi-slug-tenantId',
  instructions: 'system prompt string',
  model: customGoogle('gemini-2.0-flash'),
  memory,
  tools,
})

// Google provider — use createGoogleGenerativeAI for custom baseURL
import { createGoogleGenerativeAI } from '@ai-sdk/google'
const customGoogle = createGoogleGenerativeAI({
  baseURL: 'http://localhost:4001/v1',  // vertex-proxy
  apiKey: 'placeholder',
})
// google() from @ai-sdk/google only takes model ID — no baseURL option

// agent.generate() — memory and structuredOutput shapes
agent.generate('prompt', {
  memory: { thread: 'task:id:step:n', resource: 'tenantId' },  // NOT threadId/resourceId
  structuredOutput: { schema: ZodSchema },  // NOT output:
})
// Returns FullOutput<T> — access via result.object

// MCPClient tools
const tools = await mcpClient.listTools()     // flat Record<string, Tool> — for Agent
const toolsets = await client.listToolsets()  // nested — for display/debugging

// PostgresStore — requires id field
import { PostgresStore } from '@mastra/pg'
new PostgresStore({
  id: 'mastra-pg-store',  // REQUIRED
  pool,
  schemaName: 'mastra',
})
```

---

## Current Quality Bar

Be honest with yourself about the current state. Phase 1 is complete.

**What works well:**
- Multi-tenant isolation (Docker per tenant + Mastra resourceId scoping)
- Plan approval state machine (atomic, race-condition safe)
- RAG pipeline (Phase 1 hardened — correct sort order, 0.5 threshold)
- Token/cost recording + quota enforcement
- Conversation persistence
- MCP tool integrations (25 tools)
- PII filtering on user input (Aadhaar, PAN, phone — 14 patterns)
- Task watchdog Lambda (no more stuck tasks)
- 24 unit tests via Vitest
- Mastra task executor (Phase 2 started)

**Still missing / deferred:**
- 4 of 5 north-star tools absent (web_search, code_execution, browser, file_read)
- No blue/green deployment for relay (every deploy drops sessions)
- No distributed trace ID across services
- Mastra observability (mastra_ai_spans not wired to dashboard)
- Python ai-service (ingest + evals) — not built yet

---

## Non-Negotiable Rules

1. **Both surfaces.** Every fix must cover chat AND task board unless explicitly documented as surface-specific.

2. **No silent failures.** If something goes wrong, it must be logged, surfaced, and recoverable. Silent fallbacks are banned.

3. **Structured errors.** Every error response: `{ error: string, code: string, traceId: string }`. No bare strings.

4. **Language boundaries.** TypeScript does not do ML. Python does not do REST API. The boundary is HTTP.

5. **Schema first.** Any new data structure gets a Zod schema. Any new agent output gets a typed schema. No `any`. No untyped JSON.

6. **Test what you ship.** If you add a new code path, add a test for it. No exceptions.

7. **Git is the source of truth.** Never edit on GCP VM directly. Code → git → deploy.

8. **Read before you write.** Before changing any file, read it completely. Report what you find. Wait for confirmation before implementing.

9. **Feature flags for runtime switching.** `USE_MASTRA_TASKS` is the model. New paths behind flags until production data proves them.

---

## Key Commands

```bash
# Start local dev
pnpm dev

# Build all packages
pnpm build

# TypeScript check (run before committing)
npx tsc --noEmit

# DB schema changes
pnpm db:generate  # generates migration
pnpm db:migrate   # applies migration

# Lambda deploy (from Linux VM)
pnpm --filter @serverless-saas/api build
sam build && sam deploy

# GCP VM deploy — relay (includes Mastra)
cd /home/suyashresearchwork/serverless-saas && git pull
cd apps/relay && npm run build && pm2 restart agent-relay

# GCP VM deploy — other services
cd apps/mcp-server && npm run build && pm2 restart mcp-server
cd apps/vertex-proxy && npm run build && pm2 restart vertex-proxy

# View GCP VM logs
pm2 logs agent-relay --lines 100 --nostream
pm2 logs mcp-server --lines 50 --nostream

# Enable Mastra path on GCP VM
# Add to apps/relay/.env:
#   USE_MASTRA_TASKS=true
#   VERTEX_PROXY_URL=http://localhost:4001/v1
#   GEMINI_API_KEY=placeholder
#   MCP_SERVER_SSE_URL=http://localhost:3002/sse
pm2 restart agent-relay
```

---

## Active Test Config

| Key | Value |
|---|---|
| Active test tenantId | 48070bc4-e2de-4051-960d-9b72d9a0d2bf |
| Old wrong tenantId (do not use) | 24ed421c-efd2-410a-9c8b-b76621213a07 |
| OpenClaw config file | `~/.openclaw/openclaw-test.json` (NOT openclaw.json) |
| GCP VM relay port | 3001 |
| OpenClaw port | 18790 |
| Vertex proxy port | 4001 |
| MCP server port | 3002 |
| Agent server port | 3003 |
| Mastra port | none — runs inside relay |
| Active Model | gemini-2.0-flash |
| Mastra feature flag | USE_MASTRA_TASKS=false (default) |

---

## How to Get Help

1. Read `CLAUDE.md` at monorepo root first
2. Read the relevant source file completely
3. Check `production-readiness-audit.md` for known issues
4. Check `north-star-principles.md` for principle context
5. Check `07_mastra_integration.md` for Mastra-specific details
6. Ask in team channel with: what you read, what you tried, exact error

Do not make assumptions about code you have not read. Do not fix things you have not diagnosed.
