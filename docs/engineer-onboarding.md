# Engineer Onboarding — Platform OS
**Last Updated:** May 2026  
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
  agent-relay    :3001  ← your primary service
  mcp-server     :3002  ← tool integrations
  agent-server   :3003  ← container provisioning
  vertex-proxy   :4001  ← LLM translation layer
  openclaw-src   :18790 ← agent runtime
  web-frontend   :3000  ← Next.js build
```

---

## The Code

Everything is in the monorepo: `serverless-saas/`

```
apps/
  api/        — Lambda REST API. Your CRUD routes live here.
  worker/     — SQS consumer. Task execution worker lives here.
  web/        — Next.js frontend.
  relay/      — Agent relay SOURCE (deployed to GCP VM from git)
  mcp-server/ — MCP gateway SOURCE (deployed to GCP VM from git)
  agent-server/ — Container provisioning SOURCE
  vertex-proxy/ — LLM proxy SOURCE

packages/foundation/
  auth/       — JWT verification, Cognito
  database/   — Drizzle schema, all DB tables
  entitlements/ — Plan limits, quota checking
  cache/      — Redis
  storage/    — S3
  types/      — Shared TypeScript types
```

**Important:** GCP VM services pull source from git. `/opt/agent-relay/` on the VM is the running instance. `apps/relay/` in the monorepo is the source. They should be the same code. If you change relay code, commit → push → VM pulls → build → restart.

---

## The Database

**Neon (serverless Postgres)** — `serverless-saas/dev/database` in AWS Secrets Manager.

Key tables:
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

Never write raw SQL. Use Drizzle ORM. Schema changes → `pnpm db:generate` → `pnpm db:migrate`.

---

## The Agent Runtime

**OpenClaw** handles the ReAct loop (reason → tool call → observe → repeat). You do not write this code. OpenClaw is upstream OSS.

Each tenant gets their own OpenClaw Docker container provisioned by `agent-server`. The relay connects to the right container based on `tenantId`.

**What you control:**
- IDENTITY.md — agent's persona and instructions (written from DB at provision)
- SOUL.md — base behavioral template
- Tool list — which MCP tools are available (injected per session)
- Model — which LLM routes through vertex-proxy

**What OpenClaw controls:**
- ReAct loop execution
- Session memory (within container lifetime)
- Tool call orchestration

---

## The Task Board Flow

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
Relay runs each step → sends to OpenClaw → collects output
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
Relay fetches RAG context (/rag/retrieve)
    ↓
Relay builds: [system] + [history] + [RAG] + [new message]
    ↓
Relay → OpenClaw WebSocket → streams response
    ↓
Relay saves messages to DB (fire-and-forget)
    ↓
Relay fires eval metrics (fire-and-forget)
```

---

## Current Quality Bar

Be honest with yourself about the current state. The audit found:

**What works well:**
- Multi-tenant isolation (Docker per tenant, hard routing refusal)
- Plan approval state machine (atomic, race-condition safe)
- RAG pipeline (better than most competitors)
- Token/cost recording
- Conversation persistence
- MCP tool integrations (25 tools)

**What is broken or missing:**
- Agent step output silently stores garbage when LLM returns prose
- Tasks can get permanently stuck if relay crashes during execution
- No rate limiting — any tenant can spam the system
- PII goes verbatim to LLM — Aadhaar, PAN, phone numbers
- Zero unit tests, zero integration tests
- Billing quota never enforced — free plan burns unlimited GPU
- Internal API routes accessible from public internet

---

## Non-Negotiable Rules

1. **Both surfaces.** Every fix must cover chat AND task board unless explicitly documented as surface-specific.

2. **No silent failures.** If something goes wrong, it must be logged, surfaced, and recoverable. Silent fallbacks are banned.

3. **Structured errors.** Every error response: `{ error: string, code: string, traceId: string }`. No bare strings.

4. **Language boundaries.** TypeScript does not do ML. Python does not do REST API. The boundary is HTTP.

5. **Schema first.** Any new data structure gets a Zod schema. Any new agent output gets a typed schema. No `any`. No untyped JSON.

6. **Test what you ship.** If you add a new code path, add a test for it. No exceptions in Phase 1.

7. **Git is the source of truth.** Never edit on GCP VM directly. Code → git → deploy.

8. **Read before you write.** Before changing any file, read it completely. Report what you find. Wait for confirmation before implementing.

---

## Key Commands

```bash
# Start local dev
pnpm dev

# Build all packages
pnpm build

# DB schema changes
pnpm db:generate  # generates migration
pnpm db:migrate   # applies migration

# Lambda deploy (from Linux VM)
pnpm --filter @serverless-saas/api build
sam build && sam deploy

# GCP VM deploy
cd /opt/agent-relay && git pull && npm run build && pm2 restart agent-relay

# View GCP VM logs
pm2 logs agent-relay --lines 100 --nostream
pm2 logs mcp-server --lines 50 --nostream

# DB query (from Linux VM)
DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id serverless-saas/dev/database \
  --region ap-south-1 \
  --query 'SecretString' --output text | \
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).url)") \
  node -e "const { neon } = require('@neondatabase/serverless'); \
  const sql = neon(process.env.DATABASE_URL); \
  sql\`YOUR QUERY\`.then(r => console.log(JSON.stringify(r, null, 2)));"
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
| Active Model | gemini-2.0-flash-exp |

---

## How to Get Help

1. Read `CLAUDE.md` at monorepo root first
2. Read the relevant source file completely
3. Check `03_PRODUCTION_AUDIT.md` for known issues
4. Check `02_AGENTIC_NORTH_STAR.md` for principle context
5. Ask in team channel with: what you read, what you tried, exact error

Do not make assumptions about code you have not read. Do not fix things you have not diagnosed.
