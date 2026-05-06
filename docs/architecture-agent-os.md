# Platform Architecture — Agent OS
**Last Updated:** May 2026  
**Status:** Phase 1 Active  
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
│  Memory systems (in-context, episodic, semantic)    │
│  MCP tool integrations                              │
│  Document ingestion                                 │
│  Eval harness                                       │
│  Observability                                      │
├─────────────────────────────────────────────────────┤
│  Layer 1 — Foundation Layer (current focus)         │
│  Auth, tenancy, multi-tenant isolation              │
│  Task state machine — deterministic                 │
│  Agent runtime — OpenClaw                           │
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
                       ├── HTTP → :3003  [agent-server]
                       │              └── docker run → :19000-19999
                       │                  [per-tenant OpenClaw containers]
                       │
                       ├── WS → :18790  [openclaw-src — shared/fallback]
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
| openclaw-src | 18790 | AI gateway + agent runtime (ReAct loop) |
| vertex-proxy | 4001 | OpenAI→Vertex/Anthropic translation layer |
| mcp-server | 3002 | MCP gateway — Gmail, Drive, Jira, Zoho |
| agent-server | 3003 | Docker container provisioning per tenant |
| agent-relay | 3001 | Central relay — WebSocket/SSE bridge |
| web-frontend | 3000 | Next.js standalone build |

---

## Monorepo Structure

```
apps/
  api/           — Lambda REST API (Hono, TypeScript)
  worker/        — SQS Lambda worker (TypeScript)
  web/           — Next.js frontend (TypeScript)
  relay/         — Agent relay (Hono/Node.js, TypeScript) [migrated from GCP VM]
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

### Current State

| Service | Language | Correct? |
|---|---|---|
| web frontend | TypeScript/Next.js | ✅ Always |
| REST API / Lambda | TypeScript/Hono | ✅ Correct |
| Agent relay | TypeScript/Hono | ✅ Correct |
| MCP server | TypeScript | ✅ Correct |
| Agent server | TypeScript | ✅ Correct |
| Vertex proxy | TypeScript | ✅ Correct |
| RAG pipeline | TypeScript (in relay) | ⚠️ Phase 2 → Python |
| Document ingestion | TypeScript (Lambda) | ⚠️ Phase 2 → Python |
| Eval harness | TypeScript (evalAuto.ts) | ⚠️ Phase 2 → Python |

### Target State (Phase 2)

```
TypeScript services          Python ai-service
─────────────────            ──────────────────────
relay → HTTP ──────────────▶ /rag/retrieve
worker → HTTP ─────────────▶ /ingest/document
relay → HTTP ──────────────▶ /classifier/intent
relay → HTTP ──────────────▶ /evals/score
```

### Why Python for AI/ML Layer

| Capability | Python has | TypeScript has |
|---|---|---|
| RAG evaluation | Ragas, DeepEval, BERTScore | Thin wrappers |
| Document parsing | unstructured.io, PyMuPDF | mammoth, pdf-parse |
| Embeddings | sentence-transformers, cross-encoders | Limited |
| Intent classification | spaCy, transformers, scikit-learn | Limited |
| Vector search | pgvector with full HNSW | Basic client |

### Why NOT Go or Rust Right Now

- Go: correct for relay control plane at scale (10x concurrent connections) — Phase 3 decision driven by measured load data
- Rust: correct for performance-critical inference components — not needed at current scale
- Decision rule: language change must be driven by data, not intuition

---

## Agent Runtime Architecture

### OpenClaw Role

OpenClaw is the **agent runtime** — handles the ReAct loop (reason → act → observe → repeat). It is NOT a multi-agent framework.

```
User-facing layer:     OpenClaw (chat, memory, messaging)
Complex workflows:     LangGraph/CrewAI via Python ai-service (Phase 2)
```

**Adapter system exists** — switching agent runtime does not require rewriting the relay.

### Multi-Agent Pattern (Phase 2)

Current: `Relay → single OpenClaw container → tools`

Target:
```
Relay → Orchestrator (intent classifier)
          ├── Researcher agent
          ├── Writer agent
          └── Validator agent
```

Pattern: **Option B — OpenClaw for chat + LangGraph for complex tasks**
- OpenClaw handles all chat and simple single-agent tasks
- LangGraph (Python) handles multi-agent task workflows
- Relay routes based on task type via intent classifier

---

## Infrastructure Decisions

### What Stays on Lambda

- REST API (auth, CRUD, billing) — stateless, correct fit
- Async workers (document ingestion, notifications) — event-driven, correct fit
- Scheduled jobs (watchdog Lambda) — cron, correct fit

### What Moves Off Lambda (Future)

- Agent execution loop — already on GCP VM, correct
- RAG pipeline — GCP VM relay, correct
- Real-time streaming — GCP VM relay, correct
- Python ai-service — GCP VM, not Lambda

### Lambda Performance (Quick Wins Available)

- Switch to ARM64 Graviton — 45-65% faster cold starts, lower cost
- Provisioned concurrency for task worker
- Current Node.js v20 cold starts: p95 1.2-2.8s (reducible to ~200ms)

### Durable Execution Decision

**Temporal: Do not self-host.** Datadog (4 years, dozens of clusters) calls it "surviving the challenges." Too much ops burden for current team size.

**Inngest: Recommended when ready.** TypeScript native, serverless, free tier (50K runs/month), zero ops. Replaces SQS + taskWorker pattern with step-level retry, pause/resume, and execution timeline UI.

**Current bridge:** Task watchdog Lambda (4 hours to build) covers the P0 recovery gap until Inngest is adopted.

---

## Key Config

| Key | Value |
|---|---|
| GCP VM relay | port 3001 |
| OpenClaw | port 18790 |
| Vertex proxy | port 4001 |
| MCP server | port 3002 |
| Agent server | port 3003 |
| API base (Lambda) | https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com |
| Chat endpoint | https://agent-saas.fitnearn.com/api/chat |
| Active test tenantId | 48070bc4-e2de-4051-960d-9b72d9a0d2bf |

---

## Build Phases

### Phase 1 — Production Grade Foundation (Current)
Fix audit gaps. Make Layer 1 solid. Team can build on platform without fighting it.

### Phase 2 — OS Capabilities
Build Layer 2 and Layer 3. Python ai-service. Tool registry. Intent classifier. Multi-agent routing. Output schema system. This is what we sell.

### Phase 3 — First Product
Team builds first product on Phase 1 + Phase 2 foundation. Separate repo. Own output schema, eval harness, golden dataset. Real product reveals remaining gaps.

### Phase 4 — Scale and Open
Proven products. Onboard other businesses. SLA, versioning, support process.
