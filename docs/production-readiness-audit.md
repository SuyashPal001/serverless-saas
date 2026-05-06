# Production Readiness Audit
**Last Updated:** May 2026  
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

## Production Readiness Scorecard

| Area | Chat | Task | Biggest Blocker |
|---|---|---|---|
| Core Agent Loop | ✅ | 🟡 | Task step has zero retry on transient failure |
| Memory & Context | ✅ | 🟡 | No cross-step session continuity for tasks |
| Tool Execution | 🟡 | 🟡 | 4/5 north-star tools missing, no retry |
| Multi-tenancy | ✅ | ✅ | MCP server shared process |
| Security | 🟡 | 🟡 | Internal routes unauth'd, PII not filtered at input |
| Billing & Quotas | 🔴 | 🔴 | Usage recorded but never enforced |
| Resilience | 🔴 | 🔴 | No watchdog, no circuit breakers, single VM SPOF |
| Observability | 🟡 | 🟡 | No distributed trace ID |
| Scale | 🔴 | 🔴 | No rate limiting, no concurrency cap on chat |
| Operations | 🔴 | 🔴 | No blue/green, manual rollback, no uptime alerting |

---

## Harness Engineering Scorecard

| Layer | Exists | Coverage | Risk if Missing |
|---|---|---|---|
| L0 Data validation | ❌ NO | — | RAG returns garbage, no one notices |
| L1 Unit tests | ❌ NO | — | State machine bugs, quota gate never wired |
| L2 Integration tests | ❌ NO | — | Relay/worker contract drift — silent |
| L3 E2E simulation | 🟡 PARTIAL | evalAuto.ts — prod only, no pass@k | Broken prompts ship until DLQ fills |
| L4 Adversarial | ❌ NO | — | Prompt injection via task title |
| L5 Production monitoring | 🟡 PARTIAL | Response time + tokens — no baseline, no alert | Cost spike undetected until invoice |

**Additional harness gaps:**
- No golden dataset of test tasks with expected outputs
- No pass@k tracking anywhere
- No CI/CD gate blocking deploy on eval regression
- No `.github/workflows/` directory
- Tool call trajectories partially logged but not replayable
- LLM-as-judge exists (evalAuto.ts) but never gates a deploy
- No JSON schema validation on agent step outputs
- No cost-per-task baseline with 2x spike alert

---

## Top 15 Production Blockers

Ranked by: would cause revenue loss or customer data incident in production.

---

### P0 — Would cause incident immediately

**1. Tasks permanently stuck in in_progress**
- What breaks: Relay crashes after Lambda acks SQS execute message. Task stays in_progress forever. Watchdog Redis key is written but never consumed.
- Who affected: Every tenant with a task in execution when relay restarts
- Fix effort: 4 hours
- File: New `apps/api/src/workers/taskWatchdog.ts` + scheduled Lambda

**2. Internal API routes publicly accessible**
- What breaks: `POST /api/v1/internal/{proxy+}` has `requires_auth = false` at API Gateway. Anyone who discovers X-Service-Key can corrupt task state, poison telemetry, write fake tool logs.
- Who affected: All tenants — data integrity at risk
- Fix effort: 2 hours
- File: `infra/terraform/foundation/main.tf:243-252`

**3. Agent task DLQ may not exist**
- What breaks: `main.tf:99-103` — agent_task queue has no `create_dlq = true`. CloudWatch alarm at `alarms.tf:20` references a DLQ that may not exist. Silent failure on task exhaustion.
- Fix effort: 30 minutes
- File: `infra/terraform/foundation/main.tf:99-103`

---

### P1 — Would cause trust-destroying incident

**4. No rate limiting on any endpoint**
- What breaks: Malicious or buggy client spams task creation, chat, document uploads. Burns LLM budget, degrades service for all tenants.
- Fix effort: 8 hours
- File: `apps/api/src/app.ts` (new middleware)

**5. No blue/green deployment for relay**
- What breaks: Every relay deploy drops all active chat sessions and in-flight task execution.
- Fix effort: 8 hours (PM2 cluster mode + graceful reload)
- File: PM2 ecosystem.config.js on GCP VM

**6. MCP write tools have no hard approval gate**
- What breaks: Model sends unsolicited email or creates calendar event. Real email sent to real customer.
- Who affected: Any tenant with Gmail/Calendar/Zoho connected
- Fix effort: 12 hours
- File: `apps/mcp-server/src/gateway.ts:116-176`

**7. PII not filtered on user input**
- What breaks: User pastes Aadhaar, PAN, bank account in chat message or task description. Goes verbatim to Gemini/Claude. DPDP compliance failure.
- Who affected: All users — critical for Indian market
- Fix effort: 2 hours
- File: `apps/relay/src/index.ts` (2 call sites) + `apps/api/src/workers/taskWorker.ts`

**8. Step output silent fallback stores garbage**
- What breaks: LLM returns prose. Code warns and continues. Step stored as "completed" with raw LLM dump as summary. Customer sees completed task with garbage output. No signal anything went wrong.
- Fix effort: 4 hours
- File: `apps/relay/src/index.ts:956-990`

**9. Tool selection not verified against planned step.toolName**
- What breaks: Agent uses wrong tool for step. Step completes with wrong data. Task advances. No detection.
- Fix effort: 4 hours
- File: `apps/relay/src/index.ts:862-938`

**10. Step done detection uses regex on LLM output**
- What breaks: LLM writes "I need clarification" without the magic prefix — step marked done with wrong output. Or LLM includes `NEEDS_CLARIFICATION:` in a tool result — false positive clarification loop.
- Fix effort: 4 hours
- File: `apps/relay/src/index.ts:781-803`

---

### P2 — Business risk

**11. No token/cost quota enforcement**
- What breaks: Free plan tenant runs unlimited tasks. You absorb GPU cost. Revenue model broken.
- Fix effort: 6 hours
- File: `apps/relay/src/index.ts:1147 and :1004` (add checkUsage() call)

**12. fastGateChunks always injects top-3 regardless of score**
- What breaks: `relevanceGate.ts:13` — filter runs before sort. Top-3 by position (not score) always pass. Every RAG call injects 3 potentially irrelevant chunks. Hallucination risk on every query.
- Fix effort: 1 hour
- File: `apps/relay/src/rag/relevanceGate.ts:13`

**13. No distributed trace ID**
- What breaks: Production incident requires correlating complaint → frontend → Lambda → relay → OpenClaw → MCP. Each system has separate logs. Root cause takes hours to find.
- Fix effort: 4 hours
- File: `apps/relay/src/index.ts` (read x-trace-id header)

**14. Billing quota checkUsage() never called**
- What breaks: `packages/foundation/entitlements/src/check.ts:72-97` — `checkUsage()` correctly implemented but zero callers in LLM path. 10,000 token free plan limit is decorative.
- Fix effort: 2 hours (add pre-flight check before OpenClaw call)

**15. No harness — zero tests**
- What breaks: Any bug requiring more than one component to interact reaches production undetected. Silent data corruption, billing enforcement gaps, contract drift between relay and worker.
- Fix effort: 13 hours (minimum viable 6 unit tests)

---

## Specific Code-Level Findings

### JSON Parsing (Gap 1)

**Location:** `apps/relay/src/index.ts:957-970`

```
/\{[\s\S]*\}/ is greedy — matches first { to last }
No code fence stripping (extractPlanJson does it, step path does not)
Silent fallback: summary = agentOutput (raw LLM dump committed to DB)
```

**Proposed fix:** Port fence-stripping from `extractPlanJson`. Non-greedy match. Fail step on parse failure if toolName exists.

---

### NEEDS_CLARIFICATION Detection (Gap 2)

**Location:** `apps/relay/src/index.ts:800-803`

```
[\s\S]+ is greedy and unbounded
Called on summary only — misses planning-format { "clarificationNeeded": true }
Produces malformed questions: "What region?", "results": []}
```

**Proposed fix:** Change to `[^\n"]+`. Check raw agentOutput for planning-path format too. Call detection on both paths.

---

### Tool Selection Tracking (Gap 3)

**Location:** `apps/relay/src/index.ts:885-899`

```
tool in onToolCall callback used only to fire events
No actualToolUsed variable in outer scope
Backend receives step.toolName (planned) but never learns actual tool called
Deviation from plan is invisible in DB
```

**Proposed fix:** `let actualToolUsed: string | null = null` in step loop scope. Assign in onToolCall. Add to completion payload.

---

### fastGateChunks (Gap 4)

**Location:** `apps/relay/src/rag/relevanceGate.ts:12-18`

```
.filter() runs BEFORE .sort()
i is position in unsorted array — not top-3 by score
Low-score chunk at position 0 always passes
High-score chunk at position 5 filtered if score < 0.3
Default threshold 0.3 — CLAUDE.md RAG v2 specifies 0.5
```

**Proposed fix:** `.sort()` first, then `.filter()`. Update default threshold to 0.5.

---

### Quota Gate (Gap 5)

**Location:** Nowhere — `checkUsage()` is never called in relay

```
Three unguarded LLM entry points:
  1. POST /api/tasks/plan (line 1147)
  2. POST /api/tasks/execute (line 1004)
  3. POST /api/chat SSE (line 1332)

checkUsage() in entitlements/src/check.ts correctly implemented
fetchTenantEntitlements() helper does not exist in relay
Free plan 10,000 token limit is purely decorative
```

**Proposed fix:** Add `fetchTenantEntitlements(tenantId)` helper (mirrors `fetchTenantMcpServers` pattern). Call `checkUsage()` before each LLM entry point. Fail fast with structured error.

---

## Resilience Findings

### OpenClaw crash mid-task
`relay/src/index.ts:906-917` — onClose triggers reject. Step fails. Task goes to blocked. **No automatic retry of step.** One transient WebSocket drop = task stuck in blocked permanently. Competing products (Inngest, Temporal, Modal) retry automatically.

### Lambda timeout mid-execution
`taskWorker.ts:458` — `AbortSignal.timeout(290_000)` catches this. Task marked blocked. ✅

### Neon DB drop
DB failure during planning catches error and marks task blocked. But SQS retry path not reachable — silent block instead of retry.

### Vertex AI 429/503
No circuit breaker. No exponential backoff. No fallback to Anthropic. Step fails. User sees blocked task.

### GCP VM down
Total outage for chat and task execution. No backup relay. No failover. Lambda API continues (read-only). SQS messages queue up — tasks stay stuck until VM recovers.

---

## Data Integrity Findings

### Task stuck forever
Watchdog Redis key set at `taskWorker.ts:422-424` but never consumed. No Lambda reads `task:watchdog:*` keys. No recovery mechanism.

### SQS idempotency
- Planning: ✅ Deletes pending steps before inserting new ones
- Execution: ✅ If all steps done, skips relay
- Gap: If execution retry fires while previous relay call still running — two concurrent executions race on same task. No distributed lock.

### DB transactions for billing
No transaction on billing mutation paths. `taskEvents.insert + publishToQueue` not in a transaction — if SQS publish succeeds but event insert fails, audit trail incomplete.

---

## Scale Findings

### Max concurrent tasks per tenant
✅ Enforced at plan-approval time (`tasks.ts:367-384`). Gap: Only at approval, not at execution start — tenant can have 3 approved tasks all execute simultaneously.

### Relay concurrency
Single Node.js process on GCP VM. No admission control. No connection limit. No queue. At 100 concurrent SSE connections — GCP VM memory is the only limit. No measurement or cap.

### Connection pooling
- relay: `pg.Pool` ✅
- taskWorker: Neon HTTP driver ✅ (connection-pool-free by design)
- documentIngest: Neon HTTP driver ✅

---

## Security Findings

### Authentication
- All user-facing Lambda routes: ✅ JWT verified
- Internal routes at API Gateway: ❌ `requires_auth = false`
- Protection is X-Service-Key header only — if key leaks, any external caller can corrupt state

### Input validation
- User-facing task routes: ✅ Zod schemas on all endpoints
- Internal routes: Partial

### SQL injection
✅ Drizzle ORM with parameterized queries throughout. No raw string interpolation found.

### Cross-tenant S3 access
`storageService.downloadFile(tenantId, file.id)` — key constructed with tenantId prefix. Pattern appears sound but not fully verified without reading storage package.

### Prompt injection
`taskWorker.ts:217-229` — user input wrapped in `<user_input>` tags. ✅ Relay system prompt instructs to treat as untrusted. Partial mitigation.

---

## 3 Bugs a Harness Would Have Caught

**Bug 1 — Planning fails, execution silently continues**
`relay/src/index.ts:1276-1279` — planning returns 502 → task marked blocked (visible). `relay/src/index.ts:956-964` — execution parse failure → warn and fallback (invisible). Same function, two completely different error contracts. An L1 unit test would have flagged this.

**Bug 2 — Free plan burns unlimited GPU**
`entitlements/src/check.ts:72-97` — `checkUsage()` correctly returns `{ allowed: false }` when used >= limit. Zero callers in relay. An L1 test mocking entitlements to return `{ allowed: false }` would assert 429 — and immediately reveal the gate is never wired.

**Bug 3 — fastGateChunks injects irrelevant chunks**
`relevanceGate.ts:13-14` — filter before sort. An L0 test: seed vector store with 5 chunks about "company leave policy", query "what is 2+2?", assert `context === null`. Would have caught this immediately. Instead every RAG call injects at least 3 chunks into every agent context including arithmetic questions.

---

## Minimum Viable Harness (13 hours)

In order of risk caught per hour:

1. **Quota gate is called before OpenClaw** — mock `{ allowed: false }`, assert 429 — 2h
2. **RAG score-zero query returns null context** — seed low-score chunks, assert empty array — 1h
3. **extractPlanJson null → execution fails step** — mock prose output, assert step fail called — 2h
4. **State machine rejects invalid transitions** — test every VALID_USER_TRANSITIONS entry — 2h
5. **Planning → awaiting_approval full flow** — stub relay, assert DB state — 4h
6. **Planning returns malformed JSON → task blocked** — stub relay 502, assert blocked — 2h
