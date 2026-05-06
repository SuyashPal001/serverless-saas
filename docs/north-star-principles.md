# Agentic North Star Principles
**Last Updated:** May 2026  
**Status:** Living document  
**Source:** Verified against actual codebase — May 2026 audit

---

## What This Document Is

The north star defines what a production agentic platform must do. Every principle has been verified against the actual source code. Status reflects code reality — not docs or comments.

---

## The 15 Principles

### 1. ReAct Loop (Reason → Act → Observe → Repeat)

**What it means:** Agent reasons, calls a tool, observes the result, reasons again. Repeats until goal achieved.

**Our implementation:** OpenClaw handles this internally. Not our code to write.

**Evidence:** `apps/relay/src/openclaw.ts:271` — `stopReason === 'toolUse'` filtered so loop continues uninterrupted.

**Status: ✅ DONE — Chat and Task both**

---

### 2. Tools as First Class Citizens

**What it means:** Without tools an agent is just a chatbot.

**Tools needed:**
- `retrieve_documents` — tenant private knowledge base (RAG)
- `web_search` — live data
- `code_execution` — run code
- `browser` — browse URLs
- `file_read` — read files
- 25 MCP tools — Gmail, Drive, Calendar, Zoho, Jira

**Evidence:** `apps/mcp-server/src/gateway.ts:22-80` — 25 tools live. `retrieve_documents` always provisioned.

**Status: 🟡 PARTIAL**
- ✅ retrieve_documents working
- ✅ 25 MCP tools working
- ❌ web_search, code_execution, browser, file_read — absent from MCP server

---

### 3a. Memory — In-Context

**What it means:** Current conversation window available to agent.

**Evidence:** `apps/relay/src/index.ts:1577,1585` — last 20 turns fetched from DB and injected as XML before each message.

**Status: ✅ DONE — Chat and Task both**

---

### 3b. Memory — Episodic

**What it means:** Past conversations retrievable and injectable.

**Evidence:** `apps/relay/src/persistence.ts:35-71` — every message saved to DB. `fetchConversationHistory` reads and injects on reconnect.

**Status: ✅ DONE — Chat and Task both**

**Gap:** `saveUserMessage` is fire-and-forget — if Lambda API is down, messages silently lost.

---

### 3c. Memory — Procedural

**What it means:** Skills, how-to knowledge per tenant/agent.

**Evidence:** `apps/agent-server/index.ts:138-141` — DB system prompt written to IDENTITY.md per tenant per agent at provision time.

**Status: ✅ DONE — Chat and Task both**

---

### 3d. Memory — Semantic (RAG)

**What it means:** Vector knowledge base from tenant documents.

**Evidence:** `apps/relay/src/rag/index.ts` — full pipeline: query rewrite → fetch chunks → gate chunks. `apps/worker/src/handlers/documentIngest.ts` — document ingestion worker.

**Status: ✅ DONE**

**Gaps:**
- Query rewriting disabled (`relay/src/index.ts:539` — `// TODO: re-enable`)
- fastGateChunks has sort/filter order bug and wrong threshold (0.3 vs 0.5)
- TypeScript RAG ceiling — Phase 2 moves to Python (Ragas, proper rerankers)

---

### 4. Planning Before Acting

**What it means:** Decompose goals into steps before executing.

**Evidence:** `apps/api/src/workers/taskWorker.ts:160-387` — full planning loop. Max steps enforced. Re-plan loop with feedback history. Clarification rounds limited.

**Status: ✅ DONE — Task board**
**Status: ❌ NOT APPLICABLE — Chat (intentional — chat is reactive)**

---

### 5. Tool Calling Reliability

**What it means:** Tools actually fire correctly. Failures are handled. Tokens refresh.

**Evidence:** `apps/mcp-server/src/connectors/google.ts:31-44` — OAuth token auto-refresh. `apps/relay/src/index.ts:340-356` — every tool call logged with latency and success.

**Status: ✅ DONE**

**Gaps:**
- No retry on tool failure — one failure ends the step
- No circuit breaker for external APIs

---

### 6. Multi-LLM

**What it means:** Tenant picks model, platform routes correctly.

**Evidence:** `apps/vertex-proxy/src/router.ts:19-28` — `claude-*` → Anthropic, everything else → Vertex. `apps/relay/src/index.ts:1572` — per-agent model resolved from DB.

**Status: ✅ DONE**

---

### 7. Per-Tenant Config

**What it means:** Each tenant gets isolated agent config, tools, identity.

**Evidence:** `apps/agent-server/index.ts:134` — isolated workspace per tenant/agent. IDENTITY.md written from DB at provision.

**Status: ✅ DONE**

---

### 8. Multi-Tenant Isolation

**What it means:** Tenant A never touches tenant B.

**Evidence:** `apps/relay/src/index.ts:57-60` — hard refusal to cross-tenant route. `apps/mcp-server/src/gateway.ts:97-113` — tools filtered by tenant's active integrations.

**Status: ✅ DONE**

**Gaps:**
- MCP server is shared Node.js process — logical isolation only
- Internal routes unauthenticated at API Gateway level

---

### 9. Observability

**What it means:** Every token, tool call, and cost tracked.

**Evidence:** `apps/relay/src/index.ts:302-373` — per-turn metrics, RAG metrics, tool call logs, knowledge gap logs. `apps/relay/src/usage.ts:75-93` — three rows per turn in usage_records.

**Status: ✅ DONE**

**Gaps:**
- No distributed trace ID linking frontend → Lambda → relay → OpenClaw → MCP
- traceId sent by taskWorker but ignored in relay
- No cost-per-task baseline with spike alert

---

### 10. Human in the Loop

**What it means:** Approval gates before irreversible actions.

**Evidence:** `apps/relay/src/index.ts:1703-1769` — exec approval intercept. Task state machine has awaiting_approval that blocks execution.

**Status: ✅ DONE — Task board**
**Status: 🟡 PARTIAL — Chat**

**Gap:** MCP write tools (gmail_send, calendar_create, zoho_mail_send) have no hard programmatic gate — only LLM instruction via IDENTITY.md. If model misinterprets, tool fires.

---

### 11. Stateful Sessions

**What it means:** Context persists across conversations and restarts.

**Evidence:** `apps/relay/src/persistence.ts` — DB-backed. `apps/agent-server/index.ts:260` — OpenClaw session files on disk per container.

**Status: ✅ DONE**

**Gap:** If container destroyed and reprovisioned, OpenClaw in-memory session resets. DB history re-injected but internal reasoning context lost.

---

### 12. Agent Workflows (Proactive)

**What it means:** Agents triggered by events, schedules, data changes — not just user messages.

**Evidence:** `packages/foundation/database/schema/agents.ts:35-50` — agentWorkflows table with trigger enum: `['incident_created', 'scheduled', 'manual']`.

**Status: 🟡 PARTIAL**

**Gap:** Schema and data model complete. Manual trigger (task system) works. But NO execution engine for `scheduled` or `incident_created` triggers — no EventBridge rule, no cron Lambda, no `workflow.fire` handler in worker router.

---

### 13. Sandboxed Execution

**What it means:** Per-tenant execution boundary — cannot access other tenants' data.

**Evidence:** `apps/agent-server/index.ts:87-90` — Docker container per tenant. Port range 19000-19999.

**Status: 🟡 PARTIAL**

**Gap:** `provision.sh` on GCP VM (not in repo) — cannot verify seccomp, capability drops, read-only rootfs. MCP server shared process.

---

### 14. Privacy Router

**What it means:** PII stripped before LLM call.

**Evidence:** `apps/relay/src/pii-filter.ts:116-144` — 14 Indian PII patterns. Applied to RAG chunks before injection.

**Status: 🟡 PARTIAL**

**Gap:** filterPII called on RAG chunks only. User messages, task titles, task descriptions — all go to LLM unfiltered. Critical for Indian SME market (Aadhaar, PAN, phone numbers).

---

### 15. Intent Verification

**What it means:** Validate what agent wants to do BEFORE it does it.

**Evidence:** `apps/relay/src/openclaw.ts:433-443` — exec approval for shell/code tools. Task state machine — plan must be approved before execution.

**Status: ✅ DONE — Task board**
**Status: 🟡 PARTIAL — Chat**

**Gap:** For MCP write tools, enforcement is LLM instruction only — not programmatic gate.

---

## North Star Status Summary

| # | Principle | Chat | Task | Overall |
|---|---|---|---|---|
| 1 | ReAct Loop | ✅ | ✅ | ✅ |
| 2 | Tools as First Class | 🟡 | 🟡 | 🟡 |
| 3a | Memory In-context | ✅ | ✅ | ✅ |
| 3b | Memory Episodic | ✅ | ✅ | ✅ |
| 3c | Memory Procedural | ✅ | ✅ | ✅ |
| 3d | Memory Semantic (RAG) | ✅ | ✅ | ✅ |
| 4 | Planning | N/A | ✅ | ✅ |
| 5 | Tool Calling Reliability | ✅ | 🟡 | 🟡 |
| 6 | Multi-LLM | ✅ | ✅ | ✅ |
| 7 | Per-Tenant Config | ✅ | ✅ | ✅ |
| 8 | Multi-Tenant Isolation | ✅ | ✅ | ✅ |
| 9 | Observability | ✅ | 🟡 | 🟡 |
| 10 | Human in the Loop | 🟡 | ✅ | 🟡 |
| 11 | Stateful Sessions | ✅ | 🟡 | 🟡 |
| 12 | Agent Workflows | ❌ | 🟡 | 🟡 |
| 13 | Sandboxed Execution | 🟡 | 🟡 | 🟡 |
| 14 | Privacy Router | 🟡 | ❌ | 🟡 |
| 15 | Intent Verification | 🟡 | ✅ | 🟡 |

---

## Deterministic vs Probabilistic Map

This is critical for selling agents. What is reliable vs what varies.

| Decision Point | Currently | Should Be | Risk |
|---|---|---|---|
| Which tool to call per step | PROBABILISTIC — LLM picks | Deterministic — verify after | Wrong tool, wrong data |
| Step output format | SHOULD BE DET. BUT ISN'T — silent fallback | Deterministic — Zod schema | Garbage stored as complete |
| Task state transitions (user) | DETERMINISTIC ✅ | Same | — |
| Task state transitions (agent) | MIXED — code enforces, LLM triggers | Structured field | Step complete with wrong output |
| RAG chunk selection (production) | DETERMINISTIC — score threshold | Fix sort order bug | Top-3 garbage always injected |
| When step is done | PROBABILISTIC — regex on string | Deterministic — status field | Silent wrong completion |
| Billing quota enforcement | NOT ENFORCED | Deterministic hard gate | Unlimited LLM spend |
| Planning step count cap | DETERMINISTIC ✅ | Same | — |
| Clarification round limit | DETERMINISTIC ✅ | Same | — |
| Tool availability per tenant | DETERMINISTIC ✅ | Same | — |

**The rule:** LLM layer is probabilistic — that is correct. Everything around it must be deterministic. Control flow, output validation, state transitions, quota enforcement — all deterministic code, not LLM decisions.
