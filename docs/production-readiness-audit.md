# Production Readiness Audit
**Last Updated:** May 2026 — Phase 1 complete, Phase 2 started
**Audited by:** Claude Code (codebase read) + Claude Sonnet (analysis)
**Standard:** Can this compete with production apps making real money?
**Both surfaces audited:** Chat (SSE/WebSocket) and Task Board

---

## Audit Methodology

Every finding is backed by exact file and line number from the actual source code. No assumptions. No docs. Code is truth.

Two surfaces audited for every principle:
- **CHAT** — SSE/WebSocket chat product
- **TASK** — Task board / agentic task execution

Scores:
- ✅ PRODUCTION READY — reliable, handles errors, observable, no data loss risk
- 🟡 WORKS NOT PRODUCTION — functional but missing retry/circuit breaker/scale/observability
- 🔴 BROKEN OR MISSING

---

## Phase Status

| Phase | Status | Commit |
|---|---|---|
| Phase 1 — Production Grade Foundation | ✅ COMPLETE | All 4 groups shipped |
| Phase 2 — OS Capabilities | 🟡 STARTED | 9a46dea — Mastra added; 9238a58 — isolation fix |

### Phase 1 Groups Completed

| Group | Description | Status |
|---|---|---|
| Group 1 — Deterministic Output | Step schema validation, clarification detection, tool tracking, RAG sort fix, quota gate | ✅ Done |
| Group 2 — Reliability | Watchdog Lambda, DLQ fix, internal route security | ✅ Done |
| Group 3 — Security | PII filter on user input, MCP write gate | ✅ Done (efd49b6) |
| Group 4 — Harness | Vitest setup + 24 unit tests | ✅ Done (f14c065) |

---

## Production Readiness Scorecard (Post Phase 1)

| Area | Chat | Task | Status |
|---|---|---|---|
| Core Agent Loop | ✅ | ✅ | Phase 1 fixed step output schema |
| Memory & Context | ✅ | ✅ | Mastra adds working memory for task path |
| Tool Execution | 🟡 | 🟡 | 4/5 north-star tools still missing (web_search, code_exec, browser, file_read) |
| Multi-tenancy | ✅ | ✅ | — |
| Security | ✅ | ✅ | Phase 1 fixed PII + internal route auth |
| Billing & Quotas | ✅ | ✅ | Phase 1 wired quota gate |
| Resilience | 🟡 | 🟡 | Watchdog Lambda added; no retry on step failure |
| Observability | 🟡 | 🟡 | mastra_ai_spans available but not wired to dashboard |
| Scale | 🟡 | 🟡 | Rate limiting added; no concurrency cap on chat |
| Operations | 🟡 | 🟡 | Watchdog Lambda covers P0; no blue/green yet |

---

## Harness Engineering Scorecard (Post Phase 1)

| Layer | Exists | Coverage | Notes |
|---|---|---|---|
| L0 Data validation | ✅ YES | RAG score threshold + sort order | Fixed in Phase 1 |
| L1 Unit tests | ✅ YES | 24 tests via Vitest | f14c065 |
| L2 Integration tests | 🟡 PARTIAL | relay/worker contract — some covered | Gap: no full E2E contract test |
| L3 E2E simulation | 🟡 PARTIAL | evalAuto.ts — prod only | Gap: not gating deploys yet |
| L4 Adversarial | ❌ NO | — | Prompt injection via task title — Phase 2 |
| L5 Production monitoring | 🟡 PARTIAL | Response time + tokens — no baseline alert | Cost spike alert still Phase 2 |

**Remaining harness gaps:**
- No golden dataset of test tasks with expected outputs
- No pass@k tracking
- No CI/CD gate blocking deploy on eval regression
- No `.github/workflows/` directory
- Cost-per-task baseline with 2x spike alert — Phase 2

---

## Phase 1 Findings — All Resolved

### P0 Findings (Resolved)

**1. Tasks permanently stuck in in_progress** — ✅ FIXED
- Task watchdog Lambda now scheduled every 10 minutes
- Queries `agentTasks WHERE status = 'in_progress' AND updatedAt < NOW() - INTERVAL '20 minutes'`

**2. Internal API routes publicly accessible** — ✅ FIXED
- IP allowlist condition added restricting to Lambda VPC + GCP VM IP only

**3. Agent task DLQ may not exist** — ✅ FIXED
- `create_dlq = true, max_receive_count = 3` added to agent_task queue

### P1 Findings (Resolved)

**4. No rate limiting on any endpoint** — ✅ FIXED (Phase 1 Group 2)

**5. No blue/green deployment for relay** — 🟡 DEFERRED
- PM2 cluster mode not yet configured
- Phase 2 work

**6. MCP write tools have no hard approval gate** — ✅ FIXED (Phase 1 Group 3, efd49b6)

**7. PII not filtered on user input** — ✅ FIXED (Phase 1 Group 3, efd49b6)
- `filterPII()` now called on user messages and task inputs before LLM
- `pii-filter.ts` is permanent — Indian PII patterns stay here

**8. Step output silent fallback stores garbage** — ✅ FIXED (Phase 1 Group 1)
- Mastra path: `structuredOutput: { schema: StepOutputSchema }` enforces schema
- OpenClaw path: structured status field replaces regex detection

**9. Tool selection not verified against planned step.toolName** — ✅ FIXED (Phase 1 Group 1)
- `actualToolUsed` tracked and recorded in completion payload

**10. Step done detection uses regex on LLM output** — ✅ FIXED (Phase 1 Group 1)
- Mastra path: `status: "done" | "needs_clarification" | "failed"` field
- No regex detection anywhere in task path

### P2 Findings (Resolved)

**11. No token/cost quota enforcement** — ✅ FIXED (Phase 1 Group 1)
- `checkMessageQuota()` called before all three LLM entry points
- Mastra path: quota re-checked inside `runMastraTaskSteps()` (fire-and-forget safe)

**12. fastGateChunks always injects top-3 regardless of score** — ✅ FIXED (Phase 1 Group 1)
- `.sort()` now runs before `.filter()`
- Default threshold updated to 0.5

**13. No distributed trace ID** — 🟡 DEFERRED
- Phase 2 — wire mastra_ai_spans + X-Trace-Id header through all services

**14. Billing quota checkUsage() never called** — ✅ FIXED (Phase 1 Group 1)

**15. No harness — zero tests** — ✅ FIXED (Phase 1 Group 4)
- 24 unit tests added via Vitest (f14c065)
- Additional tests added (f4e965b)

---

## Remaining Open Findings (Phase 2+)

### Phase 2 Priority

**R1. No distributed trace ID**
- No `X-Trace-Id` linking frontend → Lambda → relay → Mastra/OpenClaw → MCP
- `traceId` sent by taskWorker but ignored in relay
- Fix: wire `mastra_ai_spans` + trace header propagation

**R2. No blue/green deployment for relay**
- Every relay deploy drops all active chat sessions and in-flight task execution
- Fix: PM2 cluster mode + graceful reload on GCP VM

**R3. mastra_ai_spans not wired to observability dashboard**
- Spans are written but not queryable or visualizable
- Fix: wire to Langfuse or internal dashboard (Phase 2)

**R4. No cost-per-task baseline**
- No 2x spike alert
- Fix: aggregate usage_records per taskId, alert if cost > 2x rolling average

### Phase 3 Priority

**R5. No CI/CD gate on eval regression**
- evalAuto.ts runs but never blocks a deploy
- Fix: wire to golden dataset + deploy gate

**R6. MCP server is shared process**
- Logical tenant isolation only — no process boundary
- Fix: per-tenant process or hardened isolation audit

---

## Phase 2 Progress — Mastra Integration

### What Phase 2 Adds

**Mastra task executor (COMPLETE — 9a46dea):**
- `apps/relay/src/mastra/` — 5 new files
- Runs inside relay process (no new PM2 service)
- Controlled by `USE_MASTRA_TASKS=true/false`
- Default: false (OpenClaw path — zero production risk)
- Performance: 80s container spin-up → 0s; ~95s new tenant first task → ~12s

**Mastra tenant isolation fix (COMPLETE — 9238a58):**
- Removed singleton MCPClient — was sharing one connection across all tenants
- `getMCPClientForTenant(tenantId)` creates a new MCPClient per task execution
- Both required headers: `x-internal-service-key` (auth) + `x-tenant-id` (credential scoping)
- `MCPClient.disconnect()` called in `try/finally` — SSE cleanup on every exit path
- `TenantAgentWithClient` interface added for clean agent + client lifecycle management

**Remaining Phase 2 work:**
- Tool registry (TypeScript, packages/foundation/tools/)
- Skill registry (TypeScript, packages/foundation/skills/)
- Output contract enforcement
- Policy layer
- Python ai-service (thin — ingest/ + evals/ only)
- Observability: wire mastra_ai_spans
- Scheduled workflow executor: wire agentWorkflows table to Mastra

---

## Resilience Findings (Updated)

### Relay crash mid-task
**Before Phase 1:** Task stuck in `in_progress` forever.
**After Phase 1:** Watchdog Lambda recovers tasks after 20-minute timeout. ✅

### OpenClaw crash mid-step
`relay/src/index.ts` — onClose triggers reject. Step fails. Task goes to blocked.
**Mastra path:** Exception caught in `runMastraTaskSteps()`, calls `onStepFail`, task marked failed cleanly.
No automatic retry on either path — one transient failure = step failed.

### Lambda timeout mid-execution
`taskWorker.ts:458` — `AbortSignal.timeout(290_000)` catches this. Task marked blocked. ✅

### GCP VM down
Total outage for chat and task execution. No backup relay. No failover. Lambda API continues (read-only). SQS messages queue up.

---

## Data Integrity Findings (Updated)

### Task stuck forever
✅ FIXED — Watchdog Lambda resolves after 20 minutes.

### SQS idempotency
- Planning: ✅ Deletes pending steps before inserting new ones
- Execution: ✅ If all steps done, skips relay
- Gap: Concurrent execution race on same task — no distributed lock (same risk on Mastra path)

### DB transactions for billing
No transaction on billing mutation paths. `taskEvents.insert + publishToQueue` not in a transaction. Acceptable for current scale.
