# Implementation Roadmap
**Last Updated:** May 2026 — Phase 1 complete, Phase 2 active
**Status:** Phase 2 started — Mastra task executor added
**Principle:** Build it right. No quick patches. No tech debt by design.

---

## The Build Principle

This is a platform OS. Other teams' products sit on it. Every fix is a platform contract — not a bug patch. Build once, build correctly.

**Team resources:** Engineers available. Claude Code as implementation assistant. CI/CD handled separately by team.

**Constraint:** Do not introduce technology that cannot be maintained at production quality. Example: Temporal self-hosted rejected — Datadog (4 years, dozens of clusters) calls it "surviving the challenges." Example: LangGraph (Python) rejected for task orchestration — Mastra (TypeScript) does the same thing with zero new infrastructure.

---

## Phase 1 — Production Grade Foundation (COMPLETE)

**Goal:** Close audit gaps. Make Layer 1 solid. Team can build on platform without fighting it.

**Completed:** All 4 groups shipped. See `production-readiness-audit.md` for full finding list.

| Group | Description | Commit |
|---|---|---|
| Group 1 — Deterministic Output | Step schema, RAG sort, quota gate, tool tracking | Done |
| Group 2 — Reliability | Watchdog Lambda, DLQ fix, internal route auth | Done |
| Group 3 — Security | PII filter, MCP write gate | efd49b6 |
| Group 4 — Harness | Vitest + 24 unit tests | f14c065 |

---

## Phase 2 — OS Capabilities (Active)

**Goal:** Build Layer 2 and Layer 3. Make the platform something teams can build serious products on. This is what we are selling.

**Language rule:** TypeScript for everything. Python ai-service is thin — 2 modules only.

---

### Step 1 — Mastra Task Executor (COMPLETE)

**Status:** ✅ Shipped — commit 9a46dea, May 2026

**What was built:**
- `apps/relay/src/mastra/memory.ts` — PostgresStore → Neon (`mastra` schema)
- `apps/relay/src/mastra/tools.ts` — MCPClient → mcp-server:3002
- `apps/relay/src/mastra/agent.ts` — per-tenant Mastra Agent
- `apps/relay/src/mastra/workflow.ts` — task step coordinator with structured output
- `apps/relay/src/mastra/index.ts` — module exports
- `apps/relay/src/app.ts` — `runMastraTaskSteps()` added above `runTaskSteps()`; feature flag branch in `POST /api/tasks/execute`

**How to activate:** Set `USE_MASTRA_TASKS=true` in relay `.env` on GCP VM.
**Default:** `false` — OpenClaw path unchanged. Zero production risk.

**What it enables:**
- Step-by-step task execution with structured output schema
- Working memory per tenant (cross-session context)
- Persistent MCP connection (no per-step reconnect)
- In-process execution (no 80s container spin-up)

---

### Step 2 — Tool Registry

**Status:** Not started

**Problem:** Tools hardcoded in `apps/mcp-server/src/gateway.ts`. No schema validation. Hallucinated tool name fails silently.

**Solution:** `tool_registry` DB table + TypeScript package `packages/foundation/tools/`

Schema:
```
tool_registry:
  id, name, description, input_schema (JSON Schema), category,
  version, tenant_allowlist, owner, status
```

Pre-execution validation: reject any tool call not matching registry. Mastra agent `tools` field populated from registry (replaces flat `listTools()` call).

**Files:**
- `packages/foundation/tools/src/index.ts` — new package
- `apps/relay/src/mastra/tools.ts` — updated to use registry
- `packages/foundation/database/schema/tools.ts` — new table

**Effort:** 8 hours

---

### Step 3 — Skill Registry

**Status:** Not started

**Problem:** Agent skills (`agent_skills` table) are system prompts — no structured capability metadata. No way to know what a skill can do without reading its prompt.

**Solution:** `packages/foundation/skills/` TypeScript package

```
SkillCapability:
  id, agentId, name, capability (enum), tools: string[],
  outputSchema: JSONSchema, version
```

Enables: output contract enforcement, per-skill quota, skill composition.

**Effort:** 6 hours

---

### Step 4 — Output Contract Enforcement

**Status:** Not started

**Problem:** Agent returns structured output (via Mastra `structuredOutput`) but downstream validation is limited to step-level. No per-product output contract.

**Solution:** Per-product output schema registry. Mastra step output validated against product contract before marking step complete. Failures → step retry or fail with structured reason.

**Files:**
- `packages/foundation/validators/src/output-contracts.ts`
- `apps/relay/src/mastra/workflow.ts` — enforce contract post-step

**Effort:** 6 hours

---

### Step 5 — Policy Layer

**Status:** Not started

**Problem:** No programmatic policy enforcement on what agents can and cannot do per tenant. MCP write gate (Phase 1) is the only policy, and it is surface-specific.

**Solution:** `agent_policies` table (already in DB schema). Relay enforces policies before tool calls:
- `allow_mcp_write: boolean`
- `allowed_tools: string[]`
- `max_steps_per_task: number`
- `pii_filter_level: 'strict' | 'standard'`

**Files:**
- `apps/relay/src/mastra/workflow.ts` — pre-tool-call policy check
- `apps/api/src/routes/agents.ts` — already has `PUT /agents/:agentId/policies`

**Effort:** 6 hours

---

### Step 6 — Python ai-service (Thin)

**Status:** Not started

**Scope (reduced from original plan):**
```
apps/ai-service/
  ingest/     — Complex PDF parsing (unstructured.io, PyMuPDF)
  evals/      — Ragas faithfulness/relevancy metrics
```

**What was cut and why:**
- `rag/` — TypeScript RAG is Phase 1 hardened. Works. No reason to move.
- `classifier/` — Phase 3, after first product reveals what routing matters.

**Why these two modules need Python:**

| Module | TypeScript ceiling | Python solution |
|---|---|---|
| ingest/ | mammoth/pdf-parse fail on scanned PDFs, mixed formats | unstructured.io handles everything |
| evals/ | No Ragas, no DeepEval, no BERTScore in TypeScript | Full eval stack available |

**Service:** FastAPI on GCP VM as new PM2 process (`ai-service`).
**Communication:** TypeScript services call via HTTP. JSON only. No shared code.

**Effort:** 16 hours (ingest) + 12 hours (evals)

---

### Step 7 — Observability Completion

**Status:** Partial (mastra_ai_spans table exists but not wired)

**Solution:**
- Distribute `X-Trace-Id` through: frontend → Lambda → relay → Mastra → MCP
- Wire `mastra_ai_spans` to Langfuse (recommended) or internal dashboard
- Per-tenant cost dashboard (aggregate usage_records per tenantId per day)
- Cost-per-task baseline with 2x spike alert

**Files:**
- `apps/relay/src/index.ts` — read and forward X-Trace-Id header
- `apps/relay/src/mastra/workflow.ts` — add traceId to generate() calls
- New: Langfuse integration or internal dashboard component

**Effort:** 8 hours

---

### Step 8 — Scheduled Workflow Executor

**Status:** Not started (schema exists)

**Problem:** `agentWorkflows` table exists. `trigger` enum: `['incident_created', 'scheduled', 'manual']`. Nothing reads it.

**Solution:**
- Add `workflow.fire` to `apps/worker/src/router.ts`
- Create `handleWorkflowFire` handler
- Wire to Mastra `runMastraWorkflow()` for execution
- Add EventBridge scheduled rule (Terraform) for `trigger = 'scheduled'` workflows

**Note:** Mastra `mastra_schedules` table is available — evaluate whether it replaces the EventBridge pattern.

**Effort:** 8 hours

---

## Phase 3 — First Product

**Goal:** Team builds first product on Phase 1 + Phase 2 foundation.

- Separate repo
- Own output schema
- Own eval harness and golden dataset
- Own agent identity (IDENTITY.md, SOUL.md)
- Real product reveals remaining platform gaps
- Platform gaps fixed during product build
- Second product ships faster because platform is proven

**Intent classifier built here** — real product reveals what routing decisions actually matter before building the classifier.

**Infrastructure considered for Phase 3:**
- REST API off Lambda → GCP VM (if measured latency data demands it)
- Go rewrite of relay (if measured load data shows Node.js bottleneck)

---

## Phase 4 — Open to Other Businesses

**Goal:** Proven products. Onboard other businesses.

- API versioning — stable contracts
- External documentation
- SLA definition
- Support process
- Onboarding flow
- Self-serve provisioning
- Durable execution (Inngest or BullMQ — decision after Phase 3 traffic data)

---

## Self-Hosting Roadmap

Decisions driven by real production traffic data — not speculation.

| Phase | Infrastructure change | Trigger |
|---|---|---|
| Phase 2 (done) | Task execution: Mastra replaces OpenClaw | OpenClaw 80s spin-up blocked new tenant UX |
| Phase 3 | REST API: Lambda → GCP VM (optional) | Measured p95 latency > acceptable threshold |
| Phase 4 | SQS + taskWorker: Inngest or BullMQ | Measured retry/step failure rate justifies durable execution |

**Rule:** Never move infrastructure based on intuition. Move when measured data proves the current setup is the bottleneck.

---

## Technology Decisions Log

### Accepted

| Decision | Rationale |
|---|---|
| Mastra for task execution | TypeScript, in-process, no new infrastructure. Replaces LangGraph. |
| OpenClaw for chat (permanent) | Chat path works well. No reason to change. |
| Python ai-service (thin — 2 modules) | ingest + evals only. RAG stays in TS. Classifier is Phase 3. |
| Inngest for durable execution (parked) | Will decide after real traffic data. Not before. |
| Lambda stays for stateless REST + async workers | Correct fit. Not for agent execution (already on GCP VM). |
| ARM64 Graviton for Lambda | 45-65% faster cold starts, lower cost. Terraform change only. |

### Rejected

| Decision | Reason |
|---|---|
| Temporal self-hosted | Ops burden. Datadog "surviving the challenges" for 4 years. |
| LangGraph for task orchestration | Mastra (TypeScript) does the same with zero new infrastructure. |
| Go rewrite of relay now | Not data-driven. No load data proving Node.js is bottleneck. |
| Rust anywhere now | No use case justifying it at current scale. |
| Python for RAG (was originally planned) | TypeScript RAG is Phase 1 hardened and works. No reason to rewrite. |
| Python for intent classifier now | Phase 3 — real product reveals what routing matters first. |
| Move REST API off Lambda now | Working. Premature. Decide when measured performance data demands it. |

---

## Deploy Workflow

```
Development (Mac)
  Claude Code edits source
  git commit → git push origin develop

Lambda services (Linux VM)
  git pull
  pnpm --filter @serverless-saas/api build
  sam build && sam deploy

GCP VM services
  cd /home/suyashresearchwork/serverless-saas && git pull
  cd apps/relay && npm run build && pm2 restart agent-relay
  cd apps/mcp-server && npm run build && pm2 restart mcp-server
  cd apps/agent-server && npm run build && pm2 restart agent-server
  cd apps/vertex-proxy && npm run build && pm2 restart vertex-proxy
```

**Note:** Monorepo is the source of truth. GCP VM builds from `apps/` directories. Mastra changes in `apps/relay/src/mastra/` deploy with relay — no separate step.

**Activating Mastra on production:**
```bash
# On GCP VM, add to relay .env:
USE_MASTRA_TASKS=true
VERTEX_PROXY_URL=http://localhost:4001/v1
GEMINI_API_KEY=placeholder  # vertex-proxy handles actual auth
MCP_SERVER_SSE_URL=http://localhost:3002/sse

pm2 restart agent-relay
```
