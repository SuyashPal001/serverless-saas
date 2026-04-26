# PROJECT.md — Saarthi Agentic SaaS Platform

Last updated: 2026-04-26 (session notes from Apr 26)

---

## 1. Project Overview

**Saarthi** is a multi-tenant agentic SaaS platform. Users create tasks in natural language; an AI agent (Gemini 2.5 Flash via OpenClaw) breaks them into steps, asks for clarification if needed, gets approval, then executes each step using real tools (Gmail, Drive, Jira, Zoho, etc.) via MCP.

The vision is a **Devin-style task execution platform** — today it is a board-based task manager where agents plan and execute work. The long-term direction is a **multi-workflow agentic platform** (Linear-style UX → parallel agent workflows → full agentic operating system for teams).

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui, TanStack Query |
| Backend API | Hono (Lambdalith on AWS Lambda), Drizzle ORM, PostgreSQL (Neon) |
| Auth | AWS Cognito (JWT, custom claims via Pre-Token Lambda) |
| Worker | AWS Lambda (SQS consumer) |
| Agent runtime | OpenClaw (self-hosted on GCP VM) + Gemini 2.5 Flash via Vertex AI |
| Tool execution | MCP server (custom, runs on GCP VM) |
| Relay | Custom Node.js WebSocket relay (runs on GCP VM) |
| Vector DB | pgvector on Neon (RAG pipeline) |
| Cache | Upstash Redis |
| Infra | Terraform (AWS infra) + AWS SAM (Lambda definitions) |
| Build | pnpm workspaces, esbuild (Lambdas), TypeScript strict |

---

## 2. Architecture — Three Machines

### Machine 1: Mac (developer machine)
- Code editing only
- `pnpm dev` for local development
- `sam build && sam deploy` to deploy Lambdas
- Never SSH to GCP or Linux VM — all relay/OpenClaw work is on GCP VM

### Machine 2: Linux VM / GCP VM — `agent-saas.fitnearn.com`
All agent infrastructure runs here under PM2:

| PM2 process | Port | What it does |
|---|---|---|
| `web-frontend` | 3000 | Next.js frontend (served via NGINX) |
| `agent-relay` | 3001 | WebSocket relay — bridges Lambda → OpenClaw |
| `mcp-server` | 3002 | MCP tool server (Gmail, Drive, Jira, Zoho, etc.) |
| `agent-server` | 3003 | Container provisioner — spins up OpenClaw Docker containers per tenant |
| `openclaw-src` | — | OpenClaw agent runtime (Docker, bridgePort ~19002 per tenant) |
| `vertex-proxy` | — | Proxies Gemini API calls through GCP service account |

**NGINX** on this machine:
- Routes `wss://agent-saas.fitnearn.com/ws` → relay port 3001
- Routes `https://agent-saas.fitnearn.com/api/tasks/` → relay port 3001
- Routes all other traffic → frontend port 3000

### Machine 3: AWS Lambda (ap-south-1)
- `apps/api` — Hono API (Lambdalith), `https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com`
- `apps/worker` — SQS consumer Lambda (task orchestration)
- Pre-Token Lambda — stamps `custom:tenantId`, `custom:role`, `custom:plan` on Cognito JWTs

### How they connect

```
User Browser
  → NGINX (GCP VM)
    → web-frontend (Next.js, port 3000)
    → /api/proxy/* → AWS Lambda API (HTTPS)

Agent task execution:
  Lambda API → SQS (plan_task / replan_task / execute_task)
    → Worker Lambda → HTTP POST to relay (RELAY_URL = https://agent-saas.fitnearn.com)
      → relay /api/tasks/plan or /api/tasks/execute
        → OpenClaw WebSocket (ws://localhost:19002 per tenant)
          → Gemini 2.5 Flash (via Vertex AI / vertex-proxy)
          → MCP tools (http://localhost:3002/sse)
            → Gmail / Drive / Jira / Zoho APIs

Step callbacks (relay → Lambda internal API):
  relay → https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com/api/v1/internal/tasks/{id}/steps/{stepId}/start|complete|fail
  relay → /internal/tasks/{id}/complete|fail|clarify
```

**Current hop count: ~8 hops** (browser → NGINX → Lambda → SQS → Worker Lambda → relay → OpenClaw → Gemini). Target: collapse relay + OpenClaw + MCP to GCP-only, cutting Lambda-SQS-Worker out of the hot path for execution.

---

## 3. Agent Task Flow (Devin-style, verified Apr 25)

```
CREATE TASK (backlog)
  ↓ user moves to "todo"
PLAN_TASK fired via SQS
  → Worker Lambda → relay /api/tasks/plan
    → OpenClaw (fresh session key: tasks:plan:{taskId}:{timestamp})
      → Gemini 2.5 Flash
        ├── clarificationNeeded=true → task → BLOCKED
        │     blockedReason = "Agent needs clarification:\n1. <question>"
        │     UI: yellow clarification box + answer input
        │     User submits answer → task → PLANNING → REPLAN_TASK on SQS
        │     → relay /api/tasks/plan with extraContext = user's answer
        │       → NEW session key (timestamp suffix) → fresh Gemini call
        │
        └── clarificationNeeded=false → steps inserted → task → AWAITING_APPROVAL
              UI: "Awaiting Approval" column on board
              Task detail: step list + Approve/Request Changes bar
              User approves → PUT /tasks/{id}/plan/approve
                → task → IN_PROGRESS → EXECUTE_TASK on SQS
                  → Worker Lambda → relay /api/tasks/execute
                    → for each step (in order):
                        POST /internal/tasks/{id}/steps/{stepId}/start
                        → OpenClaw (session key: tasks:{taskId}:{stepId})
                          → Gemini calls MCP tools (Gmail, etc.)
                            ├── success → POST /internal/tasks/{id}/steps/{stepId}/complete
                            ├── NEEDS_CLARIFICATION → POST /internal/tasks/{id}/clarify
                            └── error → POST /internal/tasks/{id}/steps/{stepId}/fail
                    → all steps done → POST /internal/tasks/{id}/complete
                      → task → REVIEW → DONE
```

### Task statuses (full set)
`backlog` → `todo` → `planning` → `awaiting_approval` → `in_progress` → `review` → `done`
Branching: `blocked` (clarification or failure), `cancelled`

---

## 4. What Was Built & Fixed (Apr 26, 2026)

### Frontend — TaskDetailView (Apr 26)

| # | Feature | Details |
|---|---|---|
| 1 | **Mark as Done button** | Green button in "Ready for your review" banner when `task.status === 'review'`. Calls `PATCH /api/v1/tasks/:taskId { status: 'done' }`, invalidates query on success. |
| 2 | **Markdown step output rendering** | `agentOutput` in StepCard now rendered via react-markdown + remark-gfm (already installed). Removed `font-mono`. Email list format (`**From:**`, `**Subject:**`, `**Date:**`) auto-detected and rendered as structured cards. |
| 3 | **Post-Action Receipt** | Shown below Agent's Plan when `task.status === 'review'` or `'done'`. Sections: What Happened (first sentence), What I Touched (tool icons: `GMAIL_*`→📧, `DRIVE_*`→📁, `CALENDAR_*`→📅, `ZOHO_*`→🏢, `WEB_SEARCH`→🔍), Results (email rows with +N more expand / react-markdown), Assumptions Made (heuristic: last paragraph containing "assumed/interpreted/treating as"), View raw toggle, Mark as Done button in footer. Replaces the previous Output section. |

### Relay fixes (Apr 26, `/opt/agent-relay/src/`)

| # | Fix | Details |
|---|---|---|
| 13 | **`patchSessionMcp` hash fix** | `config.patch` requires `baseHash` from `config.get`. `patchSessionMcp` now calls `config.get` first (5s timeout via `sendRequestAsync`), extracts hash, includes it in `config.patch`. Graceful degradation if `config.get` fails. |
| 14 | **Planning promise timeout** | `POST /api/tasks/plan` promise had no timeout — if Gemini hung silently, the HTTP request stayed open forever. Added 90-second hard timeout: fires `[tasks/plan] ... timeout after 90s`, closes OpenClaw client, rejects with error → relay returns 502 → Lambda can mark task blocked instead of hanging indefinitely. |

### What was already built (Apr 25, 2026)

### Bugs fixed

| # | Bug | File / Location | Fix |
|---|---|---|---|
| 1 | NGINX not routing `/api/tasks/` to relay | NGINX config on GCP VM | Added `location /api/tasks/` block proxying to port 3001 |
| 2 | Secrets Manager key mismatch | GCP VM relay `.env` | `INTERNAL_SERVICE_KEY` value now matches what relay sends |
| 3 | Relay rejected `acceptanceCriteria` as array | `relay/src/index.ts` | `acceptanceCriteria` now accepts array or string; relaxed required-field validation |
| 4 | `fetchTaskComments` used relative URL | `relay/src/index.ts` | Falls back to `${API_BASE_URL}/api/v1` when `INTERNAL_API_URL` not set |
| 5 | Session key mismatch — OpenClaw prefixes keys with `agent:main:` | `relay/src/openclaw.ts:246` | Changed strict equality (`===`) to `endsWith()` check |
| 6 | Empty assistant message on reconnect fired `onDone('')` | `relay/src/openclaw.ts` | Empty assistant messages now ignored; relay waits for real response |
| 7 | `clarificationNeeded` handler missing in taskWorker | `apps/api/src/workers/taskWorker.ts` | Deployed: blocked status + questions stored + `clarification_requested` event + SQS replan on user answer |
| 8 | Replan reused old session → Gemini kept asking same clarification | `relay/src/index.ts:1082` | Session key changed from `tasks:plan:${taskId}` to `tasks:plan:${taskId}:${Date.now()}` |
| 9 | `awaiting_approval` column missing from board | `apps/web/components/platform/BoardView.tsx` | Added to `COLUMNS`, `STATUS_CONFIG`, `StatusIcon`, `Task` type |
| 10 | Clarification shown as red "Execution failed" instead of yellow box | `apps/web/components/platform/TaskDetailView.tsx` | `needsClarification` now also detects via `blockedReason.startsWith('Agent needs clarification:')` — fallback when events API returns 401 |
| 11 | Approve/Reject bar only showed for `backlog` status | `apps/web/components/platform/TaskDetailView.tsx:1504` | Condition changed to `status === 'backlog' || status === 'awaiting_approval'` |
| 12 | No `awaiting_approval` banner in task detail | `apps/web/components/platform/TaskDetailView.tsx` | Added amber banner: "Plan ready — review and approve to start execution" |

### Known issue (not yet fixed)
- `GET /internal/tasks/{taskId}/comments` returns **401** for all task IDs — the relay sends `x-internal-service-key` but the Lambda internal route is validating a different header or key value. Comments never load into planning prompts.

---

## 5. Current State (Apr 25, 2026)

### Working end-to-end
- Task creation, board view (all columns including `awaiting_approval`)
- Planning via OpenClaw/Gemini — fresh session key per attempt, no cross-task contamination
- Clarification flow: blocked → yellow box → user answers → replanned → awaiting_approval
- Plan approval: Approve/Request Changes buttons in task detail
- Execution start: steps sent to OpenClaw after approval
- MCP tool calls reaching MCP server correctly (Gmail, Drive, Zoho, Jira all wired)
- RAG pipeline (retrieve_documents tool, pgvector on Neon, relevance gate)
- Full dashboard: members, roles, billing, API keys, audit log, integrations, agents

### What needs reconnecting
- **Gmail OAuth**: `No active gmail integration for tenant b132c22f-...` — reconnect from `/dashboard/integrations` before Gmail tasks can execute

### What's pending / not yet built
- Step completion callbacks from relay → Lambda (`/internal/tasks/{id}/steps/{stepId}/complete`) need the internal endpoint auth fixed (comments 401 is likely the same root cause)
- Task `REVIEW` and `DONE` transitions after execution completes
- In-app notifications for task status changes
- Recurring / scheduled tasks
- Latency improvement: collapse relay + OpenClaw + MCP to a single GCP process (cut 3 Lambda hops)

---

## 6. Key Values

### AWS / API
| Key | Value |
|---|---|
| API Gateway URL | `https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com` |
| Cognito User Pool ID | `ap-south-1_7ojsspkCU` |
| Cognito Client ID | `o8m606564m72f8uh2np6m0odl` |
| AWS Region | `ap-south-1` |

### GCP VM
| Key | Value |
|---|---|
| Public URL | `https://agent-saas.fitnearn.com` |
| WebSocket relay | `wss://agent-saas.fitnearn.com/ws` |
| Relay port | 3001 |
| MCP server port | 3002 |
| Agent server port | 3003 |
| OpenClaw bridge port (typical) | ~19002 (per-tenant, resolved via agent-server `/status/{tenantId}/default`) |
| Relay source | `/opt/agent-relay/src/` |
| MCP server source | (separate repo, served by PM2 `mcp-server`) |
| OpenClaw config (active) | `openclaw-test.json` (not `openclaw.json`) |

### Seeded IDs (dev tenant)
| Key | Value |
|---|---|
| Dev tenantId | `24ed421c-efd2-410a-9c8b-b76621213a07` |
| Dev agentId | `45a7715e-1359-4f8d-bf45-67c176d9f0c4` |

### Tested tenant (live)
| Key | Value |
|---|---|
| tenantId | `b132c22f-e489-488e-b43e-02a36e2401bb` |

---

## 7. Build & Deploy Commands

### Mac — Frontend (Next.js)
```bash
# From repo root on GCP VM (canonical copy — see CLAUDE.md)
cd /home/suyashresearchwork/serverless-saas
./deploy.sh   # builds, copies static assets, restarts PM2 web-frontend
```

### Mac — Lambda deploy
```bash
sam build && sam deploy --config-env dev      # dev
sam build && sam deploy --config-env staging  # staging
```

### GCP VM — Relay
```bash
cd /opt/agent-relay
npm run build                          # tsc compile
pm2 restart agent-relay --update-env  # restart
pm2 logs agent-relay --lines 100      # check logs
```

### GCP VM — MCP server
```bash
pm2 restart mcp-server --update-env
pm2 logs mcp-server --lines 50
```

### GCP VM — Full status
```bash
pm2 list
pm2 logs agent-relay --lines 100 --nostream
pm2 logs mcp-server --lines 50 --nostream
```

### DB (Neon)
```bash
# From packages/foundation/database/
pnpm db:generate   # generate migration
pnpm db:migrate    # apply migrations
pnpm db:seed       # seed features + plan entitlements
pnpm db:studio     # Drizzle Studio
```

---

## 8. Architecture Evolution Plan

### Current (8-hop) path for task execution
```
User → NGINX → Next.js → /api/proxy → Lambda API → SQS → Worker Lambda
  → relay (GCP VM) → OpenClaw (GCP VM) → Gemini (Vertex)
  → MCP (GCP VM) → external APIs
  → relay → Lambda internal callbacks → DB
```

### Target (3-hop) path
```
User → NGINX → Next.js
  → GCP relay (receives plan/execute directly, no Lambda/SQS in hot path)
    → OpenClaw → Gemini → MCP → external APIs
    → relay writes to DB directly or via lightweight Lambda callback
```

**What to collapse:**
- Move `plan_task` / `execute_task` trigger from Worker Lambda → direct HTTPS call from Lambda API to relay
- Remove SQS hop for task execution (keep SQS for notifications, webhooks, usage)
- Relay writes step results directly to Neon (already has DB URL)
- Eliminates ~300–500ms of SQS + Lambda cold start latency per task event

---

## 9. Connected Integrations (OAuth, live)

| Provider | `provider` value | Scopes | Connect route |
|---|---|---|---|
| Gmail | `gmail` | `['gmail']` | `POST /api/v1/integrations/google/gmail/connect` |
| Google Drive | `drive` | `['drive']` | `POST /api/v1/integrations/google/drive/connect` |
| Google Calendar | `calendar` | `['calendar']` | `POST /api/v1/integrations/google/calendar/connect` |
| Zoho CRM | `zoho_crm` | `['crm']` | `POST /api/v1/integrations/zoho/crm/connect` |
| Zoho Mail | `zoho_mail` | `['mail']` | `POST /api/v1/integrations/zoho/mail/connect` |
| Zoho Cliq | `zoho_cliq` | `['cliq']` | `POST /api/v1/integrations/zoho/cliq/connect` |
| Jira | `jira` | `['jira']` | `POST /api/v1/integrations/jira/connect` |

Credentials stored AES-256-GCM encrypted in `integrations.credentials_enc`. Tokens fetched and decrypted at tool-call time by MCP server.

---

## 10. Internal API Routes (relay → Lambda)

The relay calls these endpoints to report step progress back to Lambda. All require header `x-internal-service-key`.

| Route | Called when |
|---|---|
| `POST /api/v1/internal/tasks/{id}/steps/{stepId}/start` | Step begins execution |
| `POST /api/v1/internal/tasks/{id}/steps/{stepId}/complete` | Step succeeds (`agentOutput`, `toolResult`) |
| `POST /api/v1/internal/tasks/{id}/steps/{stepId}/fail` | Step errors (`error`) |
| `POST /api/v1/internal/tasks/{id}/complete` | All steps done |
| `POST /api/v1/internal/tasks/{id}/fail` | Task-level failure |
| `POST /api/v1/internal/tasks/{id}/clarify` | Step needs user input (`question`) |
| `POST /api/v1/internal/tasks/{id}/comments` | Relay posts agent comment |
| `GET /api/v1/internal/tasks/{id}/comments` | Relay fetches task comment history (currently 401 — auth mismatch) |

---

## 11. UX Direction

**Current:** Devin-style — one task, one agent, linear step execution, human-in-the-loop approval.

**Next milestone:** Linear-style board UX with real-time step progress, inline agent output per step, comment thread per task.

**Long-term:** Multi-workflow agentic platform — multiple agents running parallel workflows, dependencies between tasks, scheduled/recurring tasks, agent-to-agent handoffs. The platform becomes the operating system for async knowledge work.

---

## 12. Repo Structure

```
apps/
  api/          — Hono API (Lambdalith)
  web/          — Next.js 16 frontend
  worker/       — SQS consumer Lambda (task orchestration in taskWorker.ts)
packages/foundation/
  auth/         — JWT validation, Cognito client
  cache/        — Redis wrapper
  database/     — Drizzle schema, migrations, seeds
  entitlements/ — Plan/feature limits
  permissions/  — Role-based permissions
  events/       — EventBridge/SNS publishing
  validators/   — Zod schemas
  types/        — Shared TypeScript types
infra/terraform/ — All AWS infrastructure except Lambdas
template.yaml   — SAM Lambda definitions
Makefile        — Lambda build targets (esbuild)
```

**Canonical repo location (GCP VM):** `/home/suyashresearchwork/serverless-saas/`
**Dead clone (do not edit):** `/opt/serverless-saas/`
**Active branch:** `develop` — never push directly to `main`
