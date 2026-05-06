# Language & Technology Constraints
**Last Updated:** May 2026 — Phase 2 Mastra integration
**Purpose:** Engineering team reference — what language goes where and why

---

## The Constraint

Team engineers are not Google-level. The system must be buildable, debuggable, and maintainable by solid engineers who know their domain well. Language choices must support this — not fight it.

**Rule:** Never introduce a language without a clear, data-driven reason. The cost is not just implementation — it is hiring, debugging, onboarding, and long-term maintenance.

---

## Language Map

### TypeScript — Primary Language (95%+ of codebase)

**Used for:**
- `apps/web` — Next.js frontend
- `apps/api` — Hono Lambda REST API
- `apps/worker` — SQS Lambda worker
- `apps/relay` — Agent relay (WebSocket/SSE/HTTP) + Mastra executor
- `apps/mcp-server` — MCP gateway and connectors
- `apps/agent-server` — Container provisioning
- `apps/vertex-proxy` — LLM proxy

**Why TypeScript is correct here:**
- REST APIs, WebSocket relay, real-time streaming — Node.js/TS is the right fit
- Team velocity — fast iteration, single language across frontend and backend
- Hono, Drizzle, Zod, Mastra — production-grade TS ecosystem for what these services do
- Not ML code — no ML library advantage from switching

**Phase 2 addition — Mastra:**
- `apps/relay/src/mastra/` — task orchestration framework
- `@mastra/core@1.32.1` — Agent, Memory, workflow engine
- `@mastra/pg@1.10.0` — PostgresStore (Neon, mastra schema)
- `@mastra/mcp@1.7.0` — MCPClient (persistent SSE to mcp-server)
- `@mastra/memory@1.17.5` — working memory, episodic memory
- `@ai-sdk/google@3.0.67` — routes through vertex-proxy:4001

**Engineer profile:** TypeScript engineer. Senior TS for relay and API. Mid-level for MCP connectors.

---

### Python — AI/ML Layer (Phase 2, thin scope)

**Used for (2 modules only):**
- `apps/ai-service/ingest/` — Complex PDF parsing (unstructured.io, PyMuPDF)
- `apps/ai-service/evals/` — Eval harness (Ragas, DeepEval, BERTScore)

**NOT used for (modules removed from scope):**
- `rag/` — TypeScript RAG is Phase 1 hardened, stays in TS, no Python needed
- `classifier/` — Intent classifier is Phase 3, after first product launch

**Why Python is necessary for these two:**

| Capability | Python | TypeScript |
|---|---|---|
| Complex PDF parsing | unstructured.io, PyMuPDF, pdfplumber — handles scanned, mixed formats | mammoth, pdf-parse — hit ceiling on complex docs |
| RAG evaluation | Ragas, DeepEval, BERTScore — these are the libraries | No equivalent — wrappers only |
| Faithfulness/relevancy metrics | Ragas native | Not available |

**The ceiling problem — ingest:** TypeScript `mammoth`/`pdf-parse` cannot handle scanned PDFs, multi-column layouts, mixed content. This is a hard library ceiling, not a skill gap.

**The ceiling problem — evals:** Ragas faithfulness metrics, DeepEval, BERTScore — Python only. No TypeScript port at production quality.

**What is NOT a ceiling problem:**
- RAG retrieval — TypeScript `pgvector` client works fine. Stays in TS.
- Embedding generation — API call (Vertex AI). Language doesn't matter.
- Semantic search — SQL + pgvector. TypeScript handles it.

**Service boundary:** Python ai-service runs on GCP VM. TypeScript services call it via HTTP. Clean boundary — TypeScript engineer never touches Python code. Python engineer never touches relay code.

**Engineer profile:** ML engineer / Python engineer. Knows FastAPI, Ragas, unstructured.io. Does not need to know Hono or Drizzle.

---

### Go — Future Control Plane (Phase 3+)

**Not building now. Decision criteria for future:**

Go is correct for the relay control plane when:
- Node.js event loop becomes measurable bottleneck (concurrent connections)
- Load data shows P99 latency degrading under real tenant load
- Team has Go expertise available

**Performance reality:** Go handles 10x more concurrent connections per instance than Node.js. At current scale this is not the bottleneck. LLM latency (2-5 seconds per call) dwarfs any relay processing time.

**Decision trigger:** Measured load data. Not intuition. Not benchmarks. Real production traffic showing relay as the bottleneck.

**Engineer profile:** Senior Go engineer. Distributed systems background.

---

### Rust — Not on Roadmap

Rust is correct for: embedded systems, performance-critical inference, blockchain, systems programming.

None of our services are in those categories. Go handles concurrency at our scale. TypeScript handles our product services. Python handles our ML. Rust adds: steep learning curve, small hiring pool, long compile times.

**When to reconsider:** If Go becomes the bottleneck (very unlikely). Or if we build inference serving for local models.

---

## Framework Decisions

### Agent Runtime

**Two runtimes — different surfaces:**

| Surface | Runtime | Status |
|---|---|---|
| Chat | OpenClaw | Permanent — works well, no reason to change |
| Task execution | Mastra | Phase 2 — behind `USE_MASTRA_TASKS` feature flag |
| Task execution | OpenClaw | Default (flag=false) — kept for comparison |

**OpenClaw stays for chat:**
- Handles ReAct loop natively via WebSocket RPC
- Adapter system exists — relay routes to it cleanly
- Docker container per tenant — strong isolation
- 280K+ GitHub stars — community and updates

**Mastra for tasks:**
- TypeScript, runs in-process inside relay (no new PM2 service)
- Structured output schema enforcement (Zod)
- Working memory + episodic memory out of box (Neon storage)
- MCPClient maintains persistent connection to mcp-server
- Performance: 80s container spin-up → 0s; ~95s new tenant first task → ~12s

**Why NOT LangGraph:**
- Python orchestration layer = new service, new deploy, new language boundary
- Mastra does the same thing in TypeScript with zero new infrastructure
- No Python ai-service needed just for task orchestration

---

### Durable Execution

**Inngest: Parked — will decide after real traffic data.**

Not adopted yet because: no production traffic data proving that step retry rate / workflow failure rate justifies the operational cost of adding Inngest.

**Decision trigger:** Real Phase 2/3 production data showing task failure rate that Inngest would prevent.

| Factor | Inngest | Temporal self-hosted |
|---|---|---|
| Setup | npm install, hours | 2-3 weeks |
| Ops burden | Zero — serverless | High — multiple services |
| Learning curve | Hours | 40-80 hours/engineer |
| Cost | Free (50K runs/month) | Infrastructure + ops time |
| TypeScript | Native | Native |
| Quality risk | Low — your code only | High — platform + your code |

Temporal self-hosted rejected: Datadog (4yr, dozens of clusters) presented "Surviving the Challenges of Self-Hosting Temporal" — their words. Not appropriate for current team size.

**Current bridge:** Watchdog Lambda (Phase 1) covers P0 recovery.

---

### Eval Harness

**Phase 1 (current):** TypeScript evalAuto.ts — LLM-as-judge for RAG. Exists. Works. Not yet gating deploys. Keep it — it is correct TypeScript-side.

**Phase 2 (Python ai-service/evals/):** Ragas + DeepEval + BERTScore. Proper eval stack for faithfulness/relevancy scoring against golden dataset.

**Why not full eval harness in TypeScript:**
- Ragas (RAG evaluation) — Python only
- DeepEval — Python only
- BERTScore — Python only
- ROUGE — Python native (JS port exists but unmaintained)
- These are not ports — they are the libraries. TypeScript wrappers cannot replicate them.

---

### Observability

**Langfuse** — recommended for Phase 2 eval + tracing.

- Open source, self-hostable
- Free tier covers early scale
- Covers: LLM traces (wire to mastra_ai_spans), eval scores, cost attribution, quality trends
- Integrates with Python ai-service (Ragas) and TypeScript relay

**Not building:** Custom observability platform. Use Langfuse. Focus engineering on product.

---

## What Engineers Need to Know

### TypeScript Engineer (relay/API/MCP/Mastra)

Must know:
- TypeScript, Node.js
- Hono framework
- Drizzle ORM + Neon (Postgres)
- Redis (Upstash)
- WebSocket, SSE (Server-Sent Events)
- AWS Lambda, SQS, S3
- Docker basics
- Mastra (`@mastra/core`, `@mastra/memory`, `@mastra/mcp`) — for relay work

Does NOT need to know:
- Python
- ML/AI libraries beyond API calls
- Go or Rust

---

### Python Engineer (ai-service)

Must know:
- Python, FastAPI
- Ragas, DeepEval for eval
- unstructured.io, PyMuPDF for document parsing
- pgvector client (for future cross-encoder reranking if needed)

Does NOT need to know:
- TypeScript
- Hono, Drizzle
- AWS Lambda
- Mastra

---

### The Boundary

```
TypeScript services          Python ai-service (thin)
─────────────────            ──────────────────────
relay → Mastra agent         (tasks — in-process, no HTTP)
worker → HTTP ─────────────▶ apps/ai-service/ingest/
worker → HTTP ─────────────▶ apps/ai-service/evals/
```

Communication: HTTP only. JSON request/response. No shared code. No imports across the boundary. Contract is the API schema.

---

## Technology Rejection Log

Things considered and explicitly rejected with reasons:

| Technology | Rejected Because |
|---|---|
| Temporal self-hosted | Ops burden. Datadog "surviving the challenges" for 4 years. |
| LangGraph for task orchestration | Mastra (TypeScript) does the same with zero new infrastructure and no Python boundary. |
| Python for RAG pipeline | TypeScript RAG is Phase 1 hardened and works. No reason to add Python service for this. |
| Python for intent classifier now | Phase 3 — real product reveals what routing matters before building classifier. |
| Rust (now) | No use case justifying it at current scale. |
| Go (now) | Premature. No load data proving Node.js is bottleneck. |
| Single-language TypeScript forever | AI/ML ceiling for ingest parsing and Ragas eval metrics — those two modules need Python. |
| Python for REST API | No advantage. TypeScript ecosystem is better here (Hono, Zod, Drizzle). |
| LiteLLM | Supply chain attack March 24, 2026. Permanently rejected. |
| Nango for OAuth | MCP-native approach preferred. Official MCP servers handle tool calls. |
| Inngest (now) | Parked — will decide after real production traffic data. Not speculation. |
