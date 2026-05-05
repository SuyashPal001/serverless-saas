# Agent Fix Handoff — Production Audit

**Last updated**: 2026-05-05
**Branch**: `develop`
**Latest commit**: `2b7f674`

---

## What's Done (all code-only items complete)

| Commit | Fixes | Summary |
|---|---|---|
| `15dc71d` | A1, A2, B2, M2 | SQS visibility 360s, AbortSignal on execution fetch, timingSafeEqual, remove 100ms delay |
| `2622d74` | D1 | Filter pending-only steps in handleExecution (SQS retry idempotency) |
| `9812be9` | C2, C3 | MAX_STEPS_PER_TASK=20, MAX_CLARIFICATION_ROUNDS=3 (via taskEvents count, no schema change) |
| `9872a1a` | B4 | TenantId cross-verification in 5 internal routes |
| `cb925a4` | C1 | Status transition allowlist (VALID_USER_TRANSITIONS map) |
| `b4eb883` | D2 | Sequential step execution order enforcement |
| `849ab84` | J2 | Size limits: delta 50K, text 50K, agentOutput 100K |
| `9641cb4` | I1, I2 | Watchdog monitors planning (10min) + auto-cancels stale approval (7d) |
| `dd6327e` | — | Updated AUDIT-FIX-PLAN.md checklist with all commit hashes |
| `5dbc609` | C4, D3, A3 | Concurrent task limit (429), idempotent step fail (409), env-driven SSM path |
| `7344c70` | E1 | Wrap user fields in `<user_input>` tags in planning + execution relay bodies |
| `b575288` | F1 | Structured JSON logging + traceId propagation: tasks.ts → SQS → taskWorker → relay header |
| `9916147` | B1 | AES-256-GCM encryption for LLM API keys (was base64) |
| `d2b429a` | B3 | Strip raw API keys from session config sent to GCP VM relay |
| `9a125a0` | H4 | Redis health check (ensureCacheHealthy) wired into initRuntimeSecrets |
| `8590253` | J1 | fetchWithRetry utility with exponential backoff applied to embeddings + llm |
| `15a36ab` | K2, K3, N1, N2 | Session limit (10/tenant), token-aware history truncation, GCP cred TTL, WS token 30s |
| `26e22a1` | L3, O1, O3 | RAG titles-only, push circuit breaker (3 failures), per-batch token refresh |
| `d2e9dc9` | L4-2 | Fix acceptanceCriteria serialization + attachmentContext parsing in relay bodies |
| `2b7f674` | — | TaskSidebar: show real filename for attachments (was "Attachment N") |

---

## All P0 Items — DONE

Every P0 item is landed. Only G1 (token tracking columns) was deferred — needs schema migration.

---

## Remaining Deferred Items (need migration or infrastructure)

| Item | Reason |
|---|---|
| G1 — Token tracking columns | Needs `pnpm db:generate && pnpm db:migrate` |
| H1 — DLQ alerting | Terraform + CloudWatch module change |
| H2 — DB connection pooling | Neon HTTP driver is already stateless; not needed |
| K1 — OpenClaw adapter | Architecture decision required |
| M1 — WebSocket SCAN → SET | Needs changes to connect/disconnect handlers |
| L1 — Tool registry | Needs schema migration |
| L2 — Output verification | Needs schema migration |
| O2 — Vote dedup | Needs schema migration |

---

## Deployment Needed

```bash
# All code changes above (no Terraform needed):
sam build && sam deploy --config-file samconfig.dev.toml

# DB migration (for G1 when owner is ready):
cd packages/foundation/database && pnpm db:migrate
```

---

## Working Style Rules

1. **Pattern**: Read file → implement fix → verify with `grep` → commit → report → next
2. **Code-only**: No Terraform applies, no DB migrations, no Lambda deploys
3. **Commit after each fix** (or group tightly related fixes in one commit)
4. **Commit message format**: `fix(FINDING-ID): short description`
5. **Race condition guard**: Always use status predicates in WHERE clauses for updates
6. **Verify before commit**: Use `grep -n` to confirm the change landed at the right line
7. **Branch**: All changes on `develop` only
8. **Never push to `main`**

---

## Key Architecture Notes

- Internal routes (`/internal/tasks/*`) are authenticated by `x-internal-service-key` header
- The `isAuthorized()` function now uses `timingSafeEqual` (commit 15dc71d)
- Task state machine: `backlog → todo → planning → awaiting_approval → ready → in_progress → review → done`
- User-allowed transitions are in `VALID_USER_TRANSITIONS` map in `tasks.ts`
- Watchdog runs on EventBridge schedule, checks Redis TTL keys for in_progress tasks
- Planning timeout is 10 minutes, approval timeout is 7 days
- WebSocket events pushed via `pushWebSocketEvent(tenantId, payload)`
- SQS queue messages: `plan_task`, `replan_task`, `execute_task` — all now include `traceId`
- Relay calls include `x-trace-id` header for end-to-end tracing
- C3 clarification round limit uses `taskEvents` count (no schema column added)
- B3: API keys are NO LONGER sent to the GCP VM — VM must use its own credentials
- N2: WS token TTL is now 30 seconds (was 5 minutes)
- K2: Max 10 concurrent sessions per tenant enforced in session manager

---

## Attachment Context Pipeline (May 5, 2026)

### How it works
1. **Frontend** (`BoardView.tsx`): user attaches file in task creation dialog → upload → confirm → `attachmentFileIds: string[]` sent with `POST /api/v1/tasks`
2. **Lambda** (`taskWorker.ts` `extractAttachments`): downloads from S3, extracts text (PDF via pdf-parse, DOCX via mammoth, txt/md/csv as UTF-8), sends `attachmentContext` in POST body to relay
3. **Relay** (`/api/tasks/plan` + `/api/tasks/execute`): parses `attachmentContext` from body, injects `## Attached Files` section into planning/step prompts

### Critical: relay must be rebuilt after source changes
Relay runs from `/opt/agent-relay/dist/index.js` (compiled JS). After any edit to `/opt/agent-relay/src/index.ts`:
```bash
cd /opt/agent-relay && npm run build && pm2 restart agent-relay
```
Failing to rebuild = relay runs stale code silently. All attachment fixes before `d2e9dc9` failed this way.

### Frontend state caveat
After `onSuccess` fires on task creation, `attachmentFileIds` state is cleared. If the agent returns `clarificationNeeded`, user must re-attach files on the next task attempt — OR use the `/tasks/:taskId/clarify` endpoint on the existing blocked task (which re-queues `replan_task` and re-extracts from `task.attachmentFileIds` stored in DB).

### Attachment display
`task.attachmentFileIds` is `string[]` (IDs only). `TaskSidebar.tsx` fetches `GET /api/v1/files/` (returns `{ data: [{ id, filename, ... }] }`) and maps ID → filename. Fallback: "Attachment N".

---

## Reference

- Full audit plan with all 42 findings: `AUDIT-FIX-PLAN.md` (repo root)
- CLAUDE.md has full project structure, middleware chain, deploy instructions
