# PROJECT.md — Saarthi Agentic SaaS Platform

Last updated: 2026-05-15 (PM agent Phase 1 steps 1–3 + relay build fix)

## Code Rules

- **Hard limit: never create a new file longer than 300 lines.** If a file would exceed 300 lines, split it before committing.

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

## 4. What Was Built & Fixed

### Session — May 15, 2026 — PM Agent Phase 1 (Steps 1–3)

| # | Change | Details |
|---|---|---|
| 1 | **`agent_prds` DB table** | Migration 0023 applied to Neon. Drizzle schema in `packages/foundation/database/schema/pm.ts`. Enums: `prd_status` (draft\|pending_approval\|approved\|rejected), `prd_content_type` (markdown\|html). |
| 2 | **`fetchAgentContext` tool** | `apps/relay/src/mastra/tools/fetchAgentContext.ts`. Calls `/api/v1/internal/retrieve` with `X-Service-Key`, joins chunks into context string. |
| 3 | **`savePRD` tool** | `apps/relay/src/mastra/tools/savePRD.ts`. INSERT (new draft) or UPDATE (increment version) on `agent_prds`. Uses same `pg.Pool` pattern as `planService.ts`. |
| 4 | **Relay build fixed** | `tsc` was OOMing since May 14 (pre-existing, caused by @mastra/core 580 `.d.ts` files). Replaced with `build.mjs` (esbuild, bundle:false). `npm run build` unchanged. |

**No Lambda deploy needed.** Schema migration applied. Relay rebuilt + restarted.

---

### Session — Apr 28, 2026 — Task lifecycle hardening

Full audit of the task lifecycle end-to-end, then fixes applied in two commits (`27e85a0`, `3cb9921`).

#### Audit findings & fixes

| Bug | Severity | File | Fix |
|---|---|---|---|
| **BUG-1+2** `handlePlanning` no try/catch + no fetch timeout | Critical | `taskWorker.ts` | Wrapped entire planning body in try/catch. On any error: marks task `blocked` with `blockedReason`, pushes WS event, returns cleanly (SQS acks). Added `AbortSignal.timeout(55_000)` to relay fetch — prevents Lambda timeout from leaving task stuck in `planning` forever. |
| **BUG-3** SQS retry creates duplicate steps | Critical | `taskWorker.ts` | Delete all `pending` steps for the task at the start of `handlePlanning` before calling relay — makes `plan_task` and `replan_task` fully idempotent on retry. |
| **BUG-4** `response.json()` unguarded | Medium | `taskWorker.ts` | Wrapped in inner try/catch; malformed Gemini response throws into the outer catch and marks task `blocked` instead of triggering SQS retry loop. |
| **BUG-5** Delete in replan route not guarded after SQS publish | Medium | `tasks.ts` | Wrapped `db.delete(taskSteps)` in try/catch after the SQS publish. If delete throws, logs it and continues — `replan_task` is already queued and BUG-3 handles cleanup in the worker. |
| **BUG-6** Double-approve race → task runs twice | Critical | `tasks.ts` | Added `eq(agentTasks.status, 'awaiting_approval')` to the `db.update` WHERE clause. Second concurrent approve sees 0 rows updated → returns 409. `execute_task` is never double-published. |
| **BUG-7** No WS push on `ready` transition | Low | `tasks.ts` | Added `pushWebSocketEvent({ status: 'ready' })` after successful SQS publish in approve route — board updates immediately after approval. |
| **BUG-8** Watchdog TTL not refreshed on step start | Medium | `internal/tasks.ts` | Added `getCacheClient().expire(watchdog key, 600)` in `/steps/:stepId/start`. Long-running steps no longer trigger false-positive watchdog fires. |
| **BUG-9** Step complete DB write failure → step stuck in `running` | Medium | `internal/tasks.ts` | Wrapped `db.update(taskSteps)` in try/catch in `/steps/:stepId/complete`. On failure: sets `Retry-After: 2` header, returns 503 so relay can retry. |
| **BUG-10** WS drop freezes UI with no recovery | Low | `GlobalTaskStreamProvider.tsx`, `useTaskStream.ts` | Exponential backoff reconnect (1s → 2s → 4s → 8s → 16s → 30s cap, max 6 retries). On reconnect: invalidates `['tasks']` + `['task']` prefix (GlobalTaskStreamProvider) and `['task', taskId]` (useTaskStream) to catch up on missed events. Subtle bottom-right "Reconnecting…" badge shown only after first connection drops — never flashes on initial load. |
| **BUG-11** `publishToQueue` in `/complete` + `/fail` throws 500 after terminal DB write | Medium | `internal/tasks.ts` | Wrapped both `publishToQueue` calls in try/catch + log. Notification failure is non-fatal — task is already in terminal state; a naked throw would cause relay to retry `/complete` or `/fail` sending duplicate notifications. |
| **BUG-12** `/complete` has no status guard → `blocked → review` transition possible | Medium | `internal/tasks.ts` | Added `eq(agentTasks.status, 'in_progress')` to WHERE clause + `.returning()`. Returns 409 if 0 rows updated — prevents watchdog-blocked task from being silently overwritten to `review`. |
| **BUG-13** Replan: relay down leaves task in ghost `planning` state | Critical | (analysis only) | Confirmed **covered by BUG-1**: handlePlanning catch block marks task `blocked` (not `planning`). Task ends with 0 steps but is actionable — user can clarify or replan again. |
| **BUG-15+16** Watchdog marks task blocked with no status guard → double-recovery | Critical + Medium | `watchdogHandler.ts` | Added `eq(agentTasks.status, 'in_progress')` to `db.update` WHERE + `.returning()`. If 0 rows updated (agent finished or two watchdog runs overlap) → `continue` — skips event insert, WS push, SQS notification entirely. |

#### Files changed

| File | Bugs fixed |
|---|---|
| `apps/api/src/workers/taskWorker.ts` | BUG-1, 2, 3, 4 |
| `apps/api/src/routes/tasks.ts` | BUG-5, 6, 7 |
| `apps/api/src/routes/internal/tasks.ts` | BUG-8, 9, 11, 12 |
| `apps/api/src/handlers/watchdogHandler.ts` | BUG-15, 16 |
| `apps/web/components/platform/GlobalTaskStreamProvider.tsx` | BUG-10 |
| `apps/web/hooks/useTaskStream.ts` | BUG-10 |

**No migrations. No schema changes. No schema-breaking API changes.**

**Deploy needed:** `sam build && sam deploy --config-env dev` (API + worker Lambdas). `./deploy.sh` for frontend.

---

### Session 2 — Apr 26, 2026 (this session)

#### Notification system wired to task lifecycle (commit `b6313a6`)

| # | Change | File |
|---|---|---|
| 1 | **`publishToQueue` calls on task status transitions** | `apps/api/src/routes/internal/tasks.ts` |
| | `task.completed` fires when relay calls `/internal/tasks/{id}/complete` (→ `review`) | |
| | `task.failed` fires when relay calls `/internal/tasks/{id}/fail` (→ `blocked`) | |
| | `task.needs_clarification` fires when relay calls `/internal/tasks/{id}/clarify` (→ `blocked`) | |
| 2 | **`task.awaiting_approval` notification** fires after planning succeeds | `apps/api/src/workers/taskWorker.ts` |
| 3 | **`handleExecution` try/catch** — relay network errors now mark task `blocked` instead of leaving it `in_progress` forever | `apps/api/src/workers/taskWorker.ts` |
| 4 | **`SQS_PROCESSING_QUEUE_URL` added** to `TaskWorkerFunction` env vars | `template.yaml` |

**Payload shape:** `{ type: 'notification.fire', tenantId, messageType, actorId, actorType: 'agent', recipientIds: [task.createdBy], data: { taskId, taskTitle } }`

**Status:** Code committed + pushed to `develop`. Lambda **not yet deployed** — needs `sam build && sam deploy --config-env dev`.

#### Notification workflow seeds (run manually in DB)

4 message types seeded in Neon DB via raw SQL `DO $$ ... $$` block:

| `messageType` | Subject | Body |
|---|---|---|
| `task.awaiting_approval` | Plan ready for review | Saarthi has finished planning {{taskTitle}}. Review and approve the plan. |
| `task.completed` | Task complete | Saarthi has completed {{taskTitle}}. Review the results. |
| `task.needs_clarification` | Saarthi needs clarification | Saarthi has a question before continuing with {{taskTitle}}. |
| `task.failed` | Task failed | Saarthi encountered an error while working on {{taskTitle}}. |

- Templates: `tenant_id = NULL` (system-level, shared across tenants)
- Workflows + steps: one per existing tenant per message type (idempotent, `WHERE NOT EXISTS` guards)
- Channel: `in_app` only
- `{{taskTitle}}` interpolated from `data.taskTitle` at delivery time

#### Infrastructure audit findings (read-only, no changes)

- **Notifications:** Full pipeline exists (workflows → steps → jobs → delivery log → inbox → WS push). SNS topic exists but unused. Long delays (>900s) silently dropped — EventBridge pickup not implemented.
- **Scheduling:** None. No cron, no `aws_scheduler_schedule`, no `scheduledAt` field on tasks. All execution is event-driven.
- **Multi-step:** No max step limit. Each step gets its own fresh Gemini session. If relay crashes mid-execution, task stays `in_progress` (watchdog gap — partially addressed by the try/catch fix above).

#### End-to-end verification (Apr 26)

Task "Find job emails in Gmail" executed successfully:
- Planning: `clarificationNeeded=false`, 1-step plan (`GMAIL_SEARCH_EMAILS`), ~4s
- Execution: Gmail tool called, 3 real email results returned, task → `review`
- Relay logs clean, no errors

---

### Session 1 — Apr 26, 2026

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

---

## 5. Current State (Apr 28, 2026 — updated)

### Working end-to-end ✅
- Task creation, board view (all columns including `awaiting_approval`)
- Planning via OpenClaw/Gemini — fresh session key per attempt, no cross-task contamination
- Clarification flow: blocked → yellow box → user answers → replanned → awaiting_approval
- Plan approval: Approve/Request Changes buttons in task detail — **double-approve safe (BUG-6)**
- **Full execution loop verified** — steps execute, Gmail MCP tool calls succeed, task → `review`
- Post-action receipt UI (shows results, tools used, markdown output)
- Auto-reload polling during `in_progress` (5s interval, stops at `review`/`done`/`blocked`/`cancelled`)
- Phase-based layout: plan view during `awaiting_approval`/`in_progress`, receipt view during `review`/`done`
- MCP tool calls reaching MCP server correctly (Gmail, Drive, Zoho, Jira all wired)
- RAG pipeline (retrieve_documents tool, pgvector on Neon, relevance gate)
- Full dashboard: members, roles, billing, API keys, audit log, integrations, agents
- Notification infrastructure wired (DB seeded, code committed)
- **Task lifecycle hardened** — all critical and medium bugs from Apr 28 audit fixed (see Section 4)
- **WebSocket reconnect** — exponential backoff, missed-event catchup on reconnect, reconnecting badge

### Pending deploy
- **Lambda deploy needed** for all Apr 28 fixes to go live: `sam build && sam deploy --config-env dev`
- **Frontend deploy needed** for WS reconnect + reconnecting badge: `./deploy.sh`

### What's pending / not yet built
- Recurring / scheduled tasks (no infrastructure exists — would need EventBridge + schema changes)
- Max step limit enforcement (currently unbounded — Gemini decides step count)
- Long delay notification steps (>900s) silently dropped — EventBridge pickup not implemented
- New tenant onboarding: auto-create notification workflows for new tenants (currently manual SQL seed needed)
- Agent hallucination of unconnected integrations — see `docs/bugfix-notes.md` for planned fix

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
cd /home/suyashresearchwork/serverless-saas/apps/relay
npm run build                 # esbuild (not tsc — see Known Issues below)
pm2 restart agent-relay       # restart
pm2 logs agent-relay --lines 100 --nostream
```

**Note:** `tsc` OOMs due to @mastra/core having 580 `.d.ts` files. Build now uses
`node build.mjs` (esbuild, bundle:false) — fixed May 15 2026. Type checking:
`npm run type-check` (tsc --noEmit, separate step).

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
| `GET /api/v1/internal/tasks/{id}/comments` | Relay fetches task comment history |

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

---

## 13. Detailed Documentation

| Document | Description |
|---|---|
| [Platform Architecture](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/architecture-agent-os.md) | High-level strategy, layers, and long-term OS vision |
| [North Star Principles](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/north-star-principles.md) | 15 principles for production-grade agentic platforms |
| [Production Readiness Audit](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/production-readiness-audit.md) | Comprehensive audit of chat and task board readiness |
| [Implementation Roadmap](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/implementation-roadmap.md) | Phase 1 & 2 roadmap for closing gaps and building OS capabilities |
| [Tech Constraints](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/technology-constraints.md) | Engineering reference for language and framework choices |
| [Engineer Onboarding](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/engineer-onboarding.md) | Essential context for any engineer building on the Platform OS |
| [Bugfix Notes](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/bugfix-notes.md) | Ongoing log of specific bug resolutions and edge cases |
| [PMBJP RFP Mapping](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/08_rfp_mapping_pmbjp.md) | Technical mapping against AI-Driven Drug Forecasting RFP |
| [Mastra Deep Reference](file:///Users/suyash/Desktop/projects/serverless-app/serverless-saas/docs/09_mastra_deep_reference.md) | Complete API & Architecture Reference for Mastra Platform |
| [PM Agent Implementation](docs/10_pm_agent_implementation.md) | Phase 1–3 build plan, status tracker, known issues |
