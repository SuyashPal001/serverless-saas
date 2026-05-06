# Platform Architecture — Agent OS
**Last Updated:** May 2026 — Phase 2: Mastra integration + tenant isolation fix
**Status:** Phase 1 Complete. Phase 2 Active.
**Classification:** Internal Engineering Reference

---

## What We Are Building

A **multi-tenant Agent-as-a-Service platform OS**. Not a product — an operating system that products are built on top of. Our own team builds the first products. Once proven, other businesses onboard their live products onto this OS and we make them fully agentic.

**The product machine model:**
- Build product on OS → test → keep what works → drop what doesn't
- Proven products → open to other businesses
- OS is the constant. Products are the variable.

**Agent name:** Sarathi (सारथी) — calm, clear, trustworthy AI guide
**Target market:** Indian enterprise and government (initial)

---

## The 4 Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 4 — Product Layer                            │
│  Separate repo per vertical                         │
│  Own output schema, eval, golden dataset            │
│  Examples: Job Search, Research, Support Agent      │
├─────────────────────────────────────────────────────┤
│  Layer 3 — Orchestration & Governance Layer         │
│  Intent classifier                                  │
│  Tool registry (schema-validated, governed)         │
│  Multi-agent coordination                           │
│  Output schema enforcement per product type         │
│  Runtime guardrails (PII, prompt injection)         │
│  End-to-end traceability                            │
│  Human-in-the-loop gates                            │
├─────────────────────────────────────────────────────┤
│  Layer 2 — Platform Capabilities Layer              │
│  RAG pipeline                                       │
│  Memory systems (in-context, episodic, semantic,    │
│    working — via Mastra)                            │
│  MCP tool integrations                              │
│  Document ingestion                                 │
│  Eval harness                                       │
│  Observability (mastra_ai_spans + usage_records)    │
├─────────────────────────────────────────────────────┤
│  Layer 1 — Foundation Layer (COMPLETE)              │
│  Auth, tenancy, multi-tenant isolation              │
│  Task state machine — deterministic                 │
│  Agent runtime — OpenClaw (chat) + Mastra (tasks)   │
│  Storage — Neon, Redis, S3                          │
│  Billing schema                                     │
└─────────────────────────────────────────────────────┘
```

**Layer 3 is what we are selling.** Orchestration and governance is the OS differentiator.

---

## Current System Architecture

```
Browser / Telegram
    │
    ├── HTTPS → NGINX → :3000  [web-frontend — Next.js]
    │                    └── proxy → Lambda API (AWS)
    │
    └── WSS → NGINX → :3001  [agent-relay — Hono/Node.js]
                       │
                       ├── [CHAT PATH — OpenClaw permanently]
                       │   HTTP → :3003  [agent-server]
                       │              └── docker run → :19000-19999
                       │                  [per-tenant OpenClaw containers]
                       │
                       ├── [TASK PATH — Mastra in-process (USE_MASTRA_TASKS=true)]
                       │   Mastra agent runs inside relay process
                       │   └── SSE → :3002  [mcp-server] (via MCPClient)
                       │   └── HTTP → :4001  [vertex-proxy] (via @ai-sdk/google)
                       │   └── Neon (mastra schema) — memory + spans
                       │
                       ├── WS → :18790  [openclaw-src — shared/fallback + chat]
                       │              └── HTTP → :4001  [vertex-proxy]
                       │                            └── Vertex AI (Gemini)
                       │
                       ├── SSE → :3002  [mcp-server]
                       │              └── Gmail / Drive / Cal / Zoho / Jira
                       │
                       └── HTTPS → Lambda API (usage recording, RAG retrieval)

Lambda API (AWS):
    ├── apps/api     — Hono Lambdalith (REST API)
    ├── apps/worker  — SQS consumer (task orchestration)
    └── apps/web     — Next.js frontend (also on GCP VM)
```

### Three Machines

| Machine | Purpose | Deploy |
|---|---|---|
| Mac | Monorepo, Claude Code | `pnpm dev` |
| Linux VM | SAM builds, Lambda deploys | `sam build && sam deploy` |
| GCP VM | OpenClaw, relay, vertex proxy, MCP, agent-server | `pm2 restart` |

### PM2 Services on GCP VM

| Process | Port | Purpose |
|---|---|---|
| openclaw-src | 18790 | AI gateway + agent runtime (ReAct loop) — chat path |
| vertex-proxy | 4001 | OpenAI→Vertex/Anthropic translation layer |
| mcp-server | 3002 | MCP gateway — Gmail, Drive, Jira, Zoho |
| agent-server | 3003 | Docker container provisioning per tenant |
| agent-relay | 3001 | Central relay — WebSocket/SSE bridge + Mastra executor |
| web-frontend | 3000 | Next.js standalone build |

**Note:** Mastra runs **inside** `agent-relay`. It is NOT a separate PM2 process. No new service to manage.

---

## Monorepo Structure

```
apps/
  api/           — Lambda REST API (Hono, TypeScript)
  worker/        — SQS Lambda worker (TypeScript)
  web/           — Next.js frontend (TypeScript)
  relay/         — Agent relay (Hono/Node.js, TypeScript)
    src/
      mastra/    — Mastra task executor (Phase 2 addition)
        memory.ts    — PostgresStore → Neon (mastra schema)
        tools.ts     — MCPClient → mcp-server:3002
        agent.ts     — per-tenant Mastra Agent
        workflow.ts  — task step coordinator
        index.ts     — module exports
      rag/       — RAG pipeline (Phase 1 hardened, stays in TS)
      pii-filter.ts  — Indian PII patterns (permanent)
  vertex-proxy/  — LLM proxy (TypeScript) [migrated from GCP VM]
  mcp-server/    — MCP gateway (TypeScript) [migrated from GCP VM]
  agent-server/  — Container provisioning (TypeScript) [migrated from GCP VM]

packages/foundation/
  auth/          — JWT, Cognito client
  cache/         — Redis wrapper
  database/      — Drizzle schema, migrations
  ai/            — GCP credentials, AI utilities
  mcp/           — MCP integration
  events/        — EventBridge/SNS
  notifications/ — Notification utilities
  storage/       — S3 utilities
  permissions/   — RBAC
  entitlements/  — Plan/feature limits
  validators/    — Zod schemas
  types/         — Shared TypeScript types
  logger/        — Structured logging
  idempotency/   — Idempotency key handling

infra/
  terraform/     — All infrastructure as code
```

---

## Language Architecture

This is a **deliberate polyglot system**. Language choice is driven by what each layer does best — not by preference.

### Current State (Phase 2)

| Service | Language | Status |
|---|---|---|
| web frontend | TypeScript/Next.js | ✅ Permanent |
| REST API / Lambda | TypeScript/Hono | ✅ Permanent |
| Agent relay | TypeScript/Hono | ✅ Permanent |
| Mastra executor | TypeScript (@mastra/core) | ✅ Phase 2 — runs inside relay |
| MCP server | TypeScript | ✅ Permanent |
| Agent server | TypeScript | ✅ Permanent |
| Vertex proxy | TypeScript | ✅ Permanent |
| RAG pipeline | TypeScript (in relay) | ✅ Phase 1 hardened — stays in TS |
| Document ingestion | TypeScript (Lambda) + Python (ingest/) | ⚠️ Phase 2 — Python for complex PDFs |
| Eval harness | TypeScript (evalAuto.ts) + Python (evals/) | ⚠️ Phase 2 — Python for Ragas metrics |

### Python ai-service Scope (Reduced from original plan)

**Phase 2 Python ai-service is thin — 2 modules only:**

```
apps/ai-service/
  ingest/     — Complex PDF parsing (unstructured.io, PyMuPDF)
              — TypeScript PDF parse ceiling hit for complex docs
  evals/      — Ragas faithfulness/relevancy metrics
              — No TypeScript equivalent for Ragas, DeepEval, BERTScore
```

**Modules originally planned but NOT needed (removed from scope):**
- `rag/` — TypeScript RAG is Phase 1 hardened, works well, stays
- `classifier/` — Intent classifier is Phase 3, after first product launch

### Why Python for These Two Modules Only

| Module | Why Python is necessary |
|---|---|
| ingest/ | unstructured.io, PyMuPDF handle scanned PDFs, mixed formats — no TS equivalent |
| evals/ | Ragas, DeepEval, BERTScore are Python-only — not available in TypeScript |

### Why Mastra Replaces LangGraph

LangGraph (Python) was the Phase 2 plan for task orchestration. Decision reversed:

| Factor | Mastra | LangGraph |
|---|---|---|
| Language | TypeScript (same codebase) | Python (new service, new deploy) |
| Ops burden | Runs inside relay process | New GCP VM service + PM2 process |
| Integration | Direct function calls | HTTP service boundary |
| Memory | Native (mastra_* tables) | Custom implementation required |
| MCP tools | Built-in MCPClient | Manual wiring |
| License | Apache 2.0 (OSS features) | Apache 2.0 |

Mastra gives equivalent capability in TypeScript with zero new infrastructure.

### Why NOT Go or Rust Right Now

- Go: correct for relay control plane at scale (10x concurrent connections) — Phase 3+ decision driven by measured load data
- Rust: correct for performance-critical inference components — not needed at current scale
- Decision rule: language change must be driven by data, not intuition

---

## Agent Runtime Architecture

### Two Paths — Task vs Chat

```
CHAT PATH (permanent — OpenClaw):
  Relay → agent-server → OpenClaw container → vertex-proxy → Gemini

TASK PATH (Phase 2 — Mastra, feature flag):
  Relay → Mastra agent (in-process) → vertex-proxy → Gemini
         └── MCPClient → mcp-server:3002 (tools)
         └── PostgresStore → Neon mastra schema (memory)
```

**Feature flag:** `USE_MASTRA_TASKS=true` in relay `.env` activates Mastra path.
**Default:** `false` — OpenClaw for both paths (zero production risk).

### OpenClaw Role (Chat — Permanent)

OpenClaw handles the **chat surface permanently**. Handles the ReAct loop natively via WebSocket RPC. Will not be replaced for chat.

### Mastra Role (Tasks — Phase 2)

Mastra runs **inside** the relay process. No new PM2 service. No new Docker container per tenant. Connects to existing mcp-server and vertex-proxy.

**Performance improvement:**
- OpenClaw container spin-up: ~80 seconds for new tenant
- Mastra in-process: ~0 seconds (no container)
- Per-step overhead: ~500ms (OpenClaw) → ~55ms (Mastra)
- New tenant first task: ~95 seconds → ~12 seconds total

### Multi-Agent Pattern (Phase 3)

Current (Phase 2):
```
Relay → Mastra agent (single, per-tenant instructions)
```

Target (Phase 3, after first product):
```
Relay → Orchestrator (intent classifier)
          ├── Researcher agent (Mastra)
          ├── Writer agent (Mastra)
          └── Validator agent (Mastra)
```

Intent classifier is Phase 3 — after first product proves what routing decisions matter.

---

## Infrastructure Decisions

### What Stays on Lambda

- REST API (auth, CRUD, billing) — stateless, correct fit
- Async workers (document ingestion, notifications) — event-driven, correct fit
- Scheduled jobs (watchdog Lambda) — cron, correct fit

### What Moves Off Lambda (Self-Hosting Roadmap)

| Phase | What moves | Trigger |
|---|---|---|
| Phase 2 (now) | Task execution (Mastra replaces OpenClaw for tasks) | Done ✅ |
| Phase 3 | REST API off Lambda → GCP VM | 10 paying tenants OR measured p95 latency > threshold |
| Phase 4 | SQS + taskWorker → Inngest or BullMQ | Real traffic data shows retry/step failure rate justifies it |

**Rule:** Infrastructure changes driven by measured production data. Not speculation.

### Lambda Performance (Quick Wins Available)

- Switch to ARM64 Graviton — 45-65% faster cold starts, lower cost
- Provisioned concurrency for task worker
- Current Node.js v20 cold starts: p95 1.2-2.8s (reducible to ~200ms)

### Durable Execution Decision

**Temporal: Do not self-host.** Datadog (4 years, dozens of clusters) calls it "surviving the challenges." Too much ops burden for current team size.

**Inngest: Decision parked.** Will decide after real production traffic data shows whether retry/step failure rate justifies Inngest adoption. TypeScript native, serverless, free tier (50K runs/month), zero ops.

**Current bridge:** Task watchdog Lambda covers P0 recovery gap.

---

## Key Config

| Key | Value |
|---|---|
| GCP VM relay | port 3001 |
| OpenClaw | port 18790 |
| Vertex proxy | port 4001 |
| MCP server | port 3002 |
| Agent server | port 3003 |
| Mastra | runs inside relay (no separate port) |
| API base (Lambda) | https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com |
| Chat endpoint | https://agent-saas.fitnearn.com/api/chat |
| Active test tenantId | 48070bc4-e2de-4051-960d-9b72d9a0d2bf |
| Mastra feature flag | USE_MASTRA_TASKS=true/false (default false) |

---

## Build Phases

### Phase 1 — Production Grade Foundation (COMPLETE)

Closed audit gaps. Made Layer 1 solid. Team can build on platform without fighting it.

All 4 groups completed: Deterministic Output, Reliability, Security, Harness.

### Phase 2 — OS Capabilities (Active)

Building Layer 2 and Layer 3. Mastra for task execution. Python ai-service (thin — ingest + evals). Tool registry. Skill registry. Output schema enforcement. This is what we sell.

**Commits:**
- 9a46dea — Mastra task executor added (May 2026)
- 9238a58 — per-tenant MCPClient isolation fix (May 2026)

### Phase 3 — First Product

Team builds first product on Phase 1 + Phase 2 foundation. Separate repo. Own output schema, eval harness, golden dataset. Real product reveals remaining gaps.

**Intent classifier built during Phase 3** — real product reveals what routing decisions matter.

### Phase 4 — Scale and Open

Proven products. Onboard other businesses. SLA, versioning, support process.
