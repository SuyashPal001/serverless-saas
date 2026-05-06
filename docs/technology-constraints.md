# Language & Technology Constraints
**Last Updated:** May 2026  
**Purpose:** Engineering team reference — what language goes where and why

---

## The Constraint

Team engineers are not Google-level. The system must be buildable, debuggable, and maintainable by solid engineers who know their domain well. Language choices must support this — not fight it.

**Rule:** Never introduce a language without a clear, data-driven reason. The cost is not just implementation — it is hiring, debugging, onboarding, and long-term maintenance.

---

## Language Map

### TypeScript — Primary Language (90% of codebase)

**Used for:**
- `apps/web` — Next.js frontend
- `apps/api` — Hono Lambda REST API
- `apps/worker` — SQS Lambda worker
- `apps/relay` — Agent relay (WebSocket/SSE/HTTP)
- `apps/mcp-server` — MCP gateway and connectors
- `apps/agent-server` — Container provisioning
- `apps/vertex-proxy` — LLM proxy

**Why TypeScript is correct here:**
- REST APIs, WebSocket relay, real-time streaming — Node.js/TS is the right fit
- Team velocity — fast iteration, single language across frontend and backend
- Hono, Drizzle, Zod — production-grade TS ecosystem for what these services do
- Not ML code — no ML library advantage from switching

**Engineer profile:** TypeScript engineer. Senior TS for relay and API. Mid-level for MCP connectors.

---

### Python — AI/ML Layer (Phase 2)

**Used for:**
- `apps/ai-service/rag/` — RAG pipeline
- `apps/ai-service/evals/` — Eval harness
- `apps/ai-service/ingest/` — Document ingestion
- `apps/ai-service/classifier/` — Intent classifier

**Why Python is necessary here:**

| Capability | Python | TypeScript |
|---|---|---|
| RAG evaluation | Ragas, DeepEval, BERTScore | No equivalent |
| Document parsing | unstructured.io, PyMuPDF, pdfplumber | mammoth, pdf-parse (limited) |
| Embeddings | sentence-transformers, cross-encoders | Thin API wrappers |
| Intent classification | spaCy, transformers, scikit-learn | No equivalent |
| Vector search | pgvector with full HNSW, FAISS | Basic client |
| LLM eval frameworks | LangSmith, Langfuse, Braintrust native | Adapter only |

**The ceiling problem:** TypeScript RAG is currently hitting its ceiling. `fastGateChunks` uses Gemini for relevance scoring instead of a proper cross-encoder. `mammoth` cannot handle complex PDF structures. `evalAuto.ts` cannot use Ragas faithfulness metrics. These are not fixable in TypeScript — the libraries do not exist.

**Service boundary:** Python ai-service runs on GCP VM. TypeScript services call it via HTTP. Clean boundary — TypeScript engineer never touches Python code. Python engineer never touches relay code.

**Engineer profile:** ML engineer / Python engineer. Knows FastAPI, Ragas, sentence-transformers. Does not need to know Hono or Drizzle.

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

**OpenClaw** — stays as primary agent runtime.

Reasons:
- Handles ReAct loop natively
- WebSocket RPC interface — relay adapts cleanly
- Adapter system exists — can swap without relay rewrite
- 280K+ GitHub stars — community and updates

**Multi-agent (Phase 2):** LangGraph (Python) for complex workflows. OpenClaw for chat and simple tasks. Not a replacement — a complement.

Pattern:
```
Simple task → OpenClaw container
Complex multi-agent task → Python ai-service → LangGraph
```

---

### Durable Execution

**Inngest** — when ready. Not Temporal.

| Factor | Inngest | Temporal self-hosted |
|---|---|---|
| Setup | npm install, hours | 2-3 weeks |
| Ops burden | Zero — serverless | High — multiple services |
| Learning curve | Hours | 40-80 hours/engineer |
| Cost | Free (50K runs/month) | Infrastructure + ops time |
| TypeScript | Native | Native |
| Quality risk | Low — your code only | High — platform + your code |

Temporal self-hosted rejected: Datadog (4yr, dozens of clusters) presented "Surviving the Challenges of Self-Hosting Temporal" — their words. Not appropriate for current team size.

**Current bridge:** Watchdog Lambda (4 hours) covers P0 recovery until Inngest is adopted.

---

### Eval Harness

**Phase 1 (current):** TypeScript evalAuto.ts — LLM-as-judge for RAG. Exists. Works. Not gating deploys yet.

**Phase 2 (Python ai-service):** Ragas + DeepEval + BERTScore. Proper eval stack.

**Why not build full eval harness in TypeScript:**
- Ragas (RAG evaluation) — Python only
- DeepEval — Python only
- BERTScore — Python only
- ROUGE — Python native (JS port exists but unmaintained)
- These are not ports — they are the libraries. TypeScript wrappers call the Python service.

---

### Observability

**Langfuse** — recommended for Phase 2 eval + tracing.

- Open source, self-hostable
- Free tier covers early scale
- Covers: LLM traces, eval scores, cost attribution, quality trends
- Integrates with Python ai-service (Ragas) and TypeScript relay

**Not building:** Custom observability platform. Use Langfuse. Focus engineering on product.

---

## What Engineers Need to Know

### TypeScript Engineer (relay/API/MCP)

Must know:
- TypeScript, Node.js
- Hono framework
- Drizzle ORM + Neon (Postgres)
- Redis (Upstash)
- WebSocket, SSE (Server-Sent Events)
- AWS Lambda, SQS, S3
- Docker basics

Does NOT need to know:
- Python
- ML/AI libraries
- Go or Rust

---

### Python Engineer (ai-service)

Must know:
- Python, FastAPI
- Ragas, DeepEval for eval
- sentence-transformers, cross-encoders
- pgvector, FAISS
- unstructured.io, PyMuPDF
- LangGraph (Phase 2)

Does NOT need to know:
- TypeScript
- Hono, Drizzle
- AWS Lambda

---

### The Boundary

```
TypeScript services          Python ai-service
─────────────────            ──────────────────
relay/src/index.ts           apps/ai-service/
  POST /rag/retrieve ──────▶   rag/pipeline.py
  POST /ingest ───────────▶   ingest/worker.py
  POST /classify ─────────▶   classifier/intent.py
  POST /evals/score ──────▶   evals/runner.py
```

Communication: HTTP only. JSON request/response. No shared code. No imports across the boundary. Contract is the API schema.

---

## Technology Rejection Log

Things considered and explicitly rejected with reasons:

| Technology | Rejected Because |
|---|---|
| Temporal self-hosted | Ops burden. Datadog "surviving the challenges" for 4 years. |
| LangGraph replace OpenClaw | Unnecessary rewrite. Adapter system handles routing. |
| Rust (now) | No use case justifying it at current scale. |
| Go (now) | Premature. No load data proving Node.js is bottleneck. |
| Single-language TypeScript forever | AI/ML ceiling. Python libraries have no TypeScript equivalent. |
| Python for REST API | No advantage. TypeScript ecosystem is better here (Hono, Zod, Drizzle). |
| LiteLLM | Supply chain attack March 24, 2026. Permanently rejected. |
| Nango for OAuth | MCP-native approach preferred. Official MCP servers handle tool calls. |
