# Implementation Roadmap
**Last Updated:** May 2026  
**Status:** Phase 1 Active  
**Principle:** Build it right. No quick patches. No tech debt by design.

---

## The Build Principle

This is a platform OS. Other teams' products sit on it. Every fix is a platform contract — not a bug patch. Build once, build correctly.

**Team resources:** Engineers available. Claude Code as implementation assistant. CI/CD handled separately by team.

**Constraint:** Do not introduce technology that cannot be maintained at production quality. Example: Temporal self-hosted rejected — Datadog (4 years, dozens of clusters) calls it "surviving the challenges."

---

## Phase 1 — Production Grade Foundation

**Goal:** Close audit gaps. Make Layer 1 solid. Team can build on platform without fighting it.

**Standard:** Every fix must cover BOTH surfaces — chat and task board — unless explicitly noted as surface-specific.

---

### Group 1 — Deterministic Output (Engineer A)

These make agent output trustworthy. Currently the platform can store garbage silently. On a platform OS this is unacceptable — product teams have no way to know their agent returned wrong data.

**Files primarily affected:**
- `apps/relay/src/index.ts`
- `apps/relay/src/rag/relevanceGate.ts`
- `packages/foundation/entitlements/src/check.ts`

#### Fix 1 — Step output schema validation
**Problem:** `relay/src/index.ts:957-970` — greedy regex, no fence stripping, silent fallback stores raw LLM dump as completed step.

**Solution:** Port fence-stripping from `extractPlanJson`. Strict JSON parse. If parse fails AND step.toolName exists → fail step, log structured error. If parse fails AND no toolName → reasoning-only step, accept raw text, log warning.

**Surface:** Task execution primarily. Verify if chat path has same pattern.

**Effort:** 4 hours

---

#### Fix 2 — Step done detection
**Problem:** `relay/src/index.ts:800-803` — `NEEDS_CLARIFICATION:` regex. Greedy `[\s\S]+` captures trailing JSON syntax. Misses planning-format clarification response. False positives and negatives both occur.

**Solution:** Replace regex with structured status field in step output schema. `status: "done" | "needs_clarification" | "failed"`. Update LLM prompt to require this field. Read `parsedOutput.status` — never string match.

**Surface:** Task execution. Confirm chat path handling.

**Effort:** 4 hours

---

#### Fix 3 — Tool selection verification
**Problem:** `relay/src/index.ts:885-899` — `tool` in `onToolCall` fires events but is never compared against `step.toolName`. Agent deviating from plan is invisible in DB.

**Solution:** `let actualToolUsed: string | null = null` in step loop scope. Assign in `onToolCall`. Add to step completion payload. Backend records planned vs actual.

**Surface:** Task execution only (chat has no planned toolName).

**Effort:** 4 hours

---

#### Fix 4 — fastGateChunks sort/filter order
**Problem:** `apps/relay/src/rag/relevanceGate.ts:12-18` — `.filter()` runs before `.sort()`. Index `i` is position in unsorted array. Low-score chunk at position 0 always passes. Default threshold 0.3 — RAG v2 spec requires 0.5.

**Solution:** `.sort()` first, then `.filter()`. Update default threshold to 0.5. Verify all call sites.

**Surface:** Both chat and task — shared RAG pipeline. Find every `fastGateChunks` call site.

**Effort:** 1 hour

---

#### Fix 5 — Billing quota gate
**Problem:** `checkUsage()` in `packages/foundation/entitlements/src/check.ts:72-97` correctly implemented. Zero callers in relay. Three unguarded LLM entry points: plan (line 1147), execute (line 1004), chat SSE (line 1332).

**Solution:** Add `fetchTenantEntitlements(tenantId)` helper (mirrors `fetchTenantMcpServers` pattern). Call `checkUsage()` before each LLM entry point. Fail fast: task fail + comment for task paths, SSE error event for chat.

**Surface:** ALL THREE — plan, execute, chat.

**Effort:** 2 hours

---

### Group 2 — Reliability (Engineer B)

These prevent the platform from getting into unrecoverable states.

**Files primarily affected:**
- `apps/api/src/workers/taskWorker.ts` (new: taskWatchdog.ts)
- `infra/terraform/foundation/main.tf`
- `infra/terraform/foundation/alarms.tf`

#### Fix 6 — Task watchdog Lambda
**Problem:** Relay crashes after Lambda acks SQS message → task stuck in `in_progress` forever. Redis watchdog key written but never consumed.

**Solution:** Scheduled Lambda every 10 minutes. Query `agentTasks WHERE status = 'in_progress' AND updatedAt < NOW() - INTERVAL '20 minutes'`. Mark blocked. Notify tenant via existing notification system.

**Effort:** 4 hours

---

#### Fix 7 — DLQ actually exists
**Problem:** `main.tf:99-103` — agent_task queue has no `create_dlq = true`. CloudWatch alarm references DLQ that may not exist.

**Solution:** Add `create_dlq = true, max_receive_count = 3` to agent_task queue. Verify alarm references correct ARN.

**Effort:** 30 minutes

---

#### Fix 8 — Internal routes secured
**Problem:** `main.tf:243-252` — `requires_auth = false` at API Gateway for internal routes. X-Service-Key is the only protection.

**Solution:** Add IP allowlist condition in Terraform API Gateway route restricting to Lambda VPC + GCP VM IP only. Or move to VPC-only Lambda invocation.

**Effort:** 2 hours

---

### Group 3 — Security and Trust (Engineer C)

These prevent trust-destroying incidents with customer data.

**Files primarily affected:**
- `apps/relay/src/index.ts`
- `apps/relay/src/pii-filter.ts`
- `apps/mcp-server/src/gateway.ts`
- `apps/api/src/workers/taskWorker.ts`

#### Fix 9 — PII filter on user input
**Problem:** `filterPII()` exists and works. Called on RAG chunks only. User messages, task titles, task descriptions go verbatim to LLM. Critical for Indian market — Aadhaar, PAN, phone numbers.

**Solution:** Call `filterPII(userMessage)` before `openClaw.sendMessage()` in both WebSocket handler and SSE path. Call on `task.title + description` in taskWorker before relay fetch. Log detections.

**Surface:** Both chat and task.

**Effort:** 2 hours

---

#### Fix 10 — Hard gate for MCP write tools
**Problem:** `gmail_send_message`, `calendar_create_event`, `zoho_mail_send_message`, `jira_create_issue` — enforced only by LLM instruction in IDENTITY.md. If model misinterprets, tool fires. Real email sent to real customer.

**Solution:** Add `DESTRUCTIVE_TOOLS` set in `mcp-server/src/gateway.ts`. Before executing, POST to relay confirm-intent endpoint. Relay holds execution and sends `{ type: 'tool_confirm_request', toolName, args }` to frontend. Same pattern as exec approval.

**Surface:** Chat primarily (task board has plan approval as first gate).

**Effort:** 12 hours

---

### Group 4 — Harness (Engineer D)

These make the platform testable. Without a harness, regressions reach production silently.

**Files primarily affected:**
- New test files across apps/
- `apps/worker/src/handlers/evalAuto.ts`

#### Fix 11 — 6 minimum unit tests
In order of risk caught per hour:

1. Quota gate called before OpenClaw — mock `{ allowed: false }`, assert 429 — 2h
2. RAG score-zero query returns null — seed low-score chunks, assert empty array — 1h
3. Non-JSON step output fails step (not continues) — mock prose, assert fail called — 2h
4. State machine rejects invalid transitions — test every VALID_USER_TRANSITIONS entry — 2h
5. Planning → awaiting_approval full flow — stub relay, assert DB state — 4h
6. Planning malformed JSON → task blocked — stub relay 502, assert blocked — 2h

**Total: 13 hours**

---

#### Fix 12 — evalAuto.ts as pre-deploy gate
**Problem:** LLM-as-judge scoring exists and runs in production. Never gates a deploy.

**Solution:** Wire evalAuto.ts to run against golden dataset on deploy. Define pass threshold. Block deploy if score drops below threshold.

**Effort:** 4 hours

---

#### Fix 13 — Golden dataset
**Problem:** No reference inputs with expected outputs. Eval has nothing to measure against.

**Solution:** Create 20-30 curated Q&A pairs from test documents. Cover: RAG queries, task planning, clarification scenarios, tool selection, edge cases. JSON format. Version-controlled.

**Effort:** 4 hours

---

#### Fix 14 — pass@k tracking
**Problem:** No measurement of how often tasks succeed on first try vs multiple tries. No reliability floor metric.

**Solution:** Add `pass_count` and `attempt_count` to task execution logging. Track per task type. Expose in eval dashboard. Alert if pass@1 drops below 70%.

**Effort:** 4 hours

---

## Phase 2 — OS Capabilities

**Goal:** Build Layer 2 and Layer 3. Make the platform something teams can build serious products on. This is what we are selling.

**Language:** Python for AI/ML layer. TypeScript for everything else.

### Python ai-service

New service: `apps/ai-service/` — FastAPI, Python

```
apps/ai-service/
  rag/           — RAG pipeline (replaces relay/src/rag/)
  evals/         — Eval harness (Ragas, DeepEval, BERTScore)
  ingest/        — Document ingestion (unstructured.io, PyMuPDF)
  classifier/    — Intent classifier (spaCy, transformers)
```

Runs on GCP VM as PM2 process. TypeScript services call via HTTP.

**Why Python:**
- Ragas, DeepEval, BERTScore — eval ecosystem is Python-first
- sentence-transformers, cross-encoders — proper rerankers
- unstructured.io, PyMuPDF — far better document parsing
- spaCy, transformers — intent classification
- TypeScript libraries are thin wrappers with lower quality ceiling

### Tool Registry

**Problem:** Tools hardcoded in `apps/mcp-server/src/gateway.ts`. No schema validation. Hallucinated tool name fails silently.

**Solution:** `tool_registry` DB table with:
- Tool name, description, input schema (JSON Schema)
- Per-tenant allowlist
- Version, owner, category
- Pre-execution schema validation — reject any tool call not matching registry

### Intent Classifier

Routes incoming request to correct agent/workflow:
- Chat query → RAG agent
- Research task → multi-agent research crew
- Email task → email specialist agent
- Code task → code specialist agent

Lives in Python ai-service. TypeScript relay calls `/classifier/intent` before routing.

### Output Schema System

Per product type, define exactly what the agent must return:
- Job search → `{ candidates: [{ name, company, linkedIn, salary }] }`
- Research → `{ report: string, citations: [{ source, quote }] }`
- Support → `{ resolution: string, escalate: boolean, ticket: string }`

Platform enforces schema. Product defines it. No ambiguity.

### Multi-Agent Routing

Pattern: **OpenClaw for chat + LangGraph for complex tasks**

```
Relay → Intent classifier
          ├── Simple → OpenClaw container (existing)
          └── Complex → Python ai-service → LangGraph workflow
                          ├── Researcher agent
                          ├── Writer agent
                          └── Validator agent
```

Adapter system already exists — switching does not require relay rewrite.

### Observability Completion

- Distributed trace ID: `X-Trace-Id` through frontend → Lambda → relay → OpenClaw → MCP
- Per-tenant cost dashboard
- Quality trend monitoring
- Cost-per-task baseline with 2x spike alert
- Container provisioning time tracking

### Scheduled Workflow Execution

`agentWorkflows` table exists. `trigger` enum: `['incident_created', 'scheduled', 'manual']`. Nothing reads it.

**Solution:**
- Add `workflow.fire` to `apps/worker/src/router.ts`
- Create `handleWorkflowFire` handler
- Add EventBridge scheduled rule (Terraform) for `trigger = 'scheduled'` workflows

---

## Phase 3 — First Product

**Goal:** Team builds first product on Phase 1 + Phase 2 foundation.

- Separate repo
- Own output schema
- Own eval harness and golden dataset
- Own agent identity (IDENTITY.md, SOUL.md)
- Real product reveals remaining platform gaps
- Platform gaps fixed during product build
- Second product ships faster because platform is proven

---

## Phase 4 — Open to Other Businesses

**Goal:** Proven products. Onboard other businesses.

- API versioning — stable contracts
- External documentation
- SLA definition
- Support process
- Onboarding flow
- Self-serve provisioning

---

## Technology Decisions Log

### Accepted

| Decision | Rationale |
|---|---|
| OpenClaw stays as agent runtime | Adapter system exists. Works well. Python ai-service handles multi-agent. |
| Inngest for durable execution (when ready) | TypeScript native, serverless, free tier, zero ops. Not Temporal. |
| Python for AI/ML layer | Ecosystem — Ragas, DeepEval, sentence-transformers. TypeScript ceiling too low. |
| TypeScript for everything else | Team velocity. Correct for REST API, relay, WebSocket. |
| Lambda stays for stateless REST + async workers | Correct fit. Not for agent execution (already on GCP VM). |
| ARM64 Graviton for Lambda | 45-65% faster cold starts, lower cost. Terraform change only. |

### Rejected

| Decision | Reason |
|---|---|
| Temporal self-hosted | Datadog (4yr, dozens of clusters) calls it "surviving the challenges". Ops burden too high. |
| Go rewrite of relay now | Not data-driven. Make decision when load data proves Node.js is bottleneck. |
| Rust anywhere now | Not needed at current scale. Phase 4+ consideration. |
| LangGraph replace OpenClaw | Not needed. Adapter system. OpenClaw handles chat, LangGraph for complex multi-agent. |
| Move REST API off Lambda now | Working. Premature. Decide when measured performance data demands it. |

---

## Deploy Workflow (Current)

```
Development (Mac)
  Claude Code edits source
  git commit → git push origin develop

Lambda services (Linux VM)
  git pull
  pnpm --filter @serverless-saas/api build
  sam build && sam deploy

GCP VM services
  cd /opt/agent-relay && git pull && npm run build && pm2 restart agent-relay
  cd /opt/mcp-server  && git pull && npm run build && pm2 restart mcp-server
  cd /opt/agent-server && git pull && npm run build && pm2 restart agent-server
  cd /opt/vertex-proxy && git pull && npm run build && pm2 restart vertex-proxy
```

**Note:** All GCP VM services now have source in monorepo under `apps/`. GCP VM pulls from git. `/opt/` directories are deployment targets, not source of truth.
