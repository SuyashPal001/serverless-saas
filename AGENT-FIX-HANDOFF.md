# Agent Fix Handoff — Production Audit

**Last updated**: 2026-05-03
**Branch**: `develop`
**Latest commit**: `dd6327e` (docs: update AUDIT-FIX-PLAN.md with completed fix statuses)

---

## What's Done (13 fixes landed)

| Commit | Fixes | Summary |
|---|---|---|
| `15dc71d` | A1, A2, B2, M2 | SQS visibility 360s, AbortSignal on execution fetch, timingSafeEqual, remove 100ms delay |
| `2622d74` | D1 | Filter pending-only steps in handleExecution (SQS retry idempotency) |
| `9812be9` | C2, C3 | MAX_STEPS_PER_TASK=20, MAX_CLARIFICATION_ROUNDS=3 |
| `9872a1a` | B4 | TenantId cross-verification in 5 internal routes |
| `cb925a4` | C1 | Status transition allowlist (VALID_USER_TRANSITIONS map) |
| `b4eb883` | D2 | Sequential step execution order enforcement |
| `849ab84` | J2 | Size limits: delta 50K, text 50K, agentOutput 100K |
| `9641cb4` | I1, I2 | Watchdog monitors planning (10min) + auto-cancels stale approval (7d) |
| `dd6327e` | — | Updated AUDIT-FIX-PLAN.md checklist with all commit hashes |

---

## What Remains — P0 (7 items)

### Batch 1: Easy code-only fixes (do these first)

**Fix 1 — C4/L2-4: Per-tenant concurrent task limit**
- File: `apps/api/src/routes/tasks.ts` — approve endpoint (~line 351-402)
- Before transitioning to `ready`, count `in_progress` tasks for the tenant
- Limit map: `{ free: 1, starter: 3, business: 10, enterprise: 50 }`
- Get plan from `requestContext.tenant.plan` (or from entitlements)
- Return 429 with `CONCURRENT_LIMIT` error code if exceeded
- Commit: `fix(L2-4): enforce per-tenant concurrent task limit`

**Fix 2 — D3/CC-5: Idempotent step fail**
- File: `apps/api/src/routes/internal/tasks.ts` (~line 278)
- Add `eq(taskSteps.status, 'running')` to the step fail WHERE clause
- If no row updated, return 409 "Step is not in a failable state"
- Commit: `fix(CC-5): make step fail endpoint idempotent with status predicate`

**Fix 3 — A3/L1-6: SSM path hardcoded to 'dev'**
- File: `packages/foundation/cache/src/websocket-push.ts` (line 17)
- Replace hardcoded `/serverless-saas/dev/...` with env-driven path
- Use `process.env.SSM_PREFIX` or `process.env.PROJECT + process.env.ENVIRONMENT`
- Check what env vars template.yaml passes to the Lambda
- Commit: `fix(L1-6): read SSM path prefix from environment variables`

### Batch 2: Moderate complexity

**Fix 4 — E1/L4-2: Prompt injection defense**
- File: `apps/api/src/workers/taskWorker.ts` (~line 207-218 planning body, ~line 404 execution body)
- Wrap user-provided fields (title, description, referenceText, links, attachmentContext) in `<user_input>` tags
- Lambda-side only; relay system prompt update is a separate GCP VM deploy
- Commit: `fix(L4-2): wrap user content in <user_input> delimiters for prompt injection defense`

**Fix 5 — F1/CC-1: Structured logging with traceId**
- Files: `taskWorker.ts`, `internal/tasks.ts`, `watchdogHandler.ts`, `sqs.ts`
- Generate `traceId = crypto.randomUUID()` at task creation
- Propagate through SQS message → taskWorker → relay headers (`x-trace-id`)
- Replace `console.log` with structured JSON: `{ level, msg, traceId, taskId, ts }`
- Commit: `fix(CC-1): add structured logging with traceId propagation`

### Batch 3: Needs investigation / prerequisites

**Fix 6 — B1/RELAY-3: Real AES-256-GCM encryption**
- File: `packages/foundation/ai/src/utils/encryption.ts` (full rewrite)
- Replace base64 encoding with proper `crypto.createCipheriv('aes-256-gcm', ...)`
- Format: `aes256gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
- Keep backward compat: `decryptSecret` must still handle `enc:` prefix during migration
- Needs a migration script to re-encrypt existing `llm_providers.api_key_encrypted` rows
- Commit: `fix(RELAY-3): implement real AES-256-GCM encryption for API keys`

**Fix 7 — B3/RELAY-2: Stop sending raw API keys to VM**
- File: `packages/foundation/ai/src/config/bundler.ts` (~line 290-308)
- Strip API keys from session config sent to relay
- Prerequisite: GCP VM relay must have its own LLM credentials via its environment
- Commit: `fix(RELAY-2): stop sending raw API keys to relay VM`

### Deferred (needs schema migration)

**Fix 8 — G1/L4-3+RELAY-6: Token tracking columns**
- Schema: add `inputTokens`, `outputTokens`, `totalTokens`, `model`, `costUsd` to `taskSteps`
- Route: update step complete endpoint to accept and store these fields
- Requires: `pnpm db:generate && pnpm db:migrate`
- Commit: `feat(RELAY-6): add token tracking columns to taskSteps`

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
- SQS queue messages: `plan_task`, `replan_task`, `execute_task`

---

## Reference

- Full audit plan with all 42 findings: `AUDIT-FIX-PLAN.md` (repo root)
- CLAUDE.md has full project structure, middleware chain, deploy instructions
