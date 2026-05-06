# Agentic North Star Principles
**Last Updated:** May 2026 — Phase 2 Mastra integration
**Status:** Living document
**Source:** Verified against actual codebase — May 2026 audit + Phase 2 additions

---

## What This Document Is

The north star defines what a production agentic platform must do. Every principle has been verified against the actual source code. Status reflects code reality — not docs or comments.

---

## The 15 Principles

### 1. ReAct Loop (Reason → Act → Observe → Repeat)

**What it means:** Agent reasons, calls a tool, observes the result, reasons again. Repeats until goal achieved.

**Chat path:** OpenClaw handles this internally. Not our code to write.
**Task path:** Mastra `agent.generate()` with `structuredOutput` — step-by-step execution, status field drives loop control.

**Evidence (chat):** `apps/relay/src/openclaw.ts:271` — `stopReason === 'toolUse'` filtered so loop continues uninterrupted.
**Evidence (task):** `apps/relay/src/mastra/workflow.ts` — step loop with status: `done | needs_clarification | failed`.

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
**Mastra tools:** `apps/relay/src/mastra/tools.ts` — `MCPClient.listTools()` returns flat tool map to Mastra Agent.

**Status: 🟡 PARTIAL**
- ✅ retrieve_documents working
- ✅ 25 MCP tools working (chat + Mastra task path)
- ❌ web_search, code_execution, browser, file_read — absent from MCP server

---

### 3a. Memory — In-Context

**What it means:** Current conversation window available to agent.

**Evidence (chat):** `apps/relay/src/index.ts:1577,1585` — last 20 turns fetched from DB and injected as XML before each message.
**Evidence (task/Mastra):** `apps/relay/src/mastra/workflow.ts` — `agent.generate()` called with `memory: { thread: 'task:{id}:step:{n}', resource: tenantId }`. Mastra injects last 20 messages from `mastra_messages` table.

**Status: ✅ DONE — Chat and Task both**

---

### 3b. Memory — Episodic

**What it means:** Past conversations retrievable and injectable.

**Evidence (chat):** `apps/relay/src/persistence.ts:35-71` — every message saved to DB. `fetchConversationHistory` reads and injects on reconnect.
**Evidence (task/Mastra):** Mastra `PostgresStore` stores all messages in `mastra_messages` table. Thread-scoped per task+step. Persists across relay restarts (DB-backed, not in-memory).

**Status: ✅ DONE — Chat and Task both**

**Gap:** `saveUserMessage` in chat path is fire-and-forget — if Lambda API is down, messages silently lost.

---

### 3c. Memory — Procedural

**What it means:** Skills, how-to knowledge per tenant/agent.

**Evidence (chat):** `apps/agent-server/index.ts:138-141` — DB system prompt written to IDENTITY.md per tenant per agent at provision time.
**Evidence (task/Mastra):** `apps/relay/src/mastra/agent.ts` — `Agent({ instructions: config.instructions })` where `instructions` comes from `agent_skills.system_prompt` fetched at execution time. No container provisioning needed.

**Status: ✅ DONE — Chat and Task both**

---

### 3d. Memory — Semantic (RAG)

**What it means:** Vector knowledge base from tenant documents.

**Evidence:** `apps/relay/src/rag/index.ts` — full pipeline: query rewrite → fetch chunks → gate chunks. `apps/worker/src/handlers/documentIngest.ts` — document ingestion worker.

**Mastra path:** Mastra agent can call `retrieve_documents` tool via MCP when needed. Same RAG backend (`/internal/retrieve`).

**Status: ✅ DONE**

**Gaps:**
- TypeScript RAG ceiling — Phase 2 Python `ingest/` module handles complex PDFs; `evals/` module handles Ragas scoring

---

### 3e. Memory — Working (NEW — Phase 2)

**What it means:** Persistent cross-session business context per tenant. Agent remembers facts between tasks.

**Evidence:** `apps/relay/src/mastra/agent.ts` — `Memory({ options: { workingMemory: { enabled: true } } })`. Stored in `mastra_resources` table as `workingMemory` JSON. Scoped to `tenantId` as `resourceId`.

**Status: ✅ DONE — Task path (Mastra) only**
**Status: ❌ NOT IMPLEMENTED — Chat path (OpenClaw)**

---

### 4. Planning Before Acting

**What it means:** Decompose goals into steps before executing.

**Evidence:** `apps/api/src/workers/taskWorker.ts:160-387` — full planning loop. Max steps enforced. Re-plan loop with feedback history. Clarification rounds limited.

**Mastra path:** Planning still handled by `taskWorker` + OpenClaw. Mastra executor receives pre-planned steps and executes them. Planning is not Mastra's job.

**Status: ✅ DONE — Task board**
**Status: ❌ NOT APPLICABLE — Chat (intentional — chat is reactive)**

---

### 5. Tool Calling Reliability

**What it means:** Tools actually fire correctly. Failures are handled. Tokens refresh.

**Evidence:** `apps/mcp-server/src/connectors/google.ts:31-44` — OAuth token auto-refresh. `apps/relay/src/index.ts:340-356` — every tool call logged with latency and success.
**Mastra path:** `apps/relay/src/mastra/tools.ts` — MCPClient maintains persistent SSE connection to mcp-server. No per-step reconnect overhead.

**Status: ✅ DONE**

**Gaps:**
- No retry on tool failure — one failure ends the step (both paths)
- No circuit breaker for external APIs

---

### 6. Multi-LLM

**What it means:** Tenant picks model, platform routes correctly.

**Evidence (chat):** `apps/vertex-proxy/src/router.ts:19-28` — `claude-*` → Anthropic, everything else → Vertex. `apps/relay/src/index.ts:1572` — per-agent model resolved from DB.
**Evidence (Mastra):** `apps/relay/src/mastra/agent.ts` — `createGoogleGenerativeAI({ baseURL: VERTEX_PROXY_URL })` routes through vertex-proxy. Model: `gemini-2.0-flash`.

**Status: ✅ DONE**

---

### 7. Per-Tenant Config

**What it means:** Each tenant gets isolated agent config, tools, identity.

**Evidence (chat):** `apps/agent-server/index.ts:134` — isolated workspace per tenant/agent. IDENTITY.md written from DB at provision.
**Evidence (Mastra):** `apps/relay/src/mastra/agent.ts` — `agentId = saarthi-{slug}-{tenantId}`. Instructions from `agent_skills.system_prompt`. Memory scoped to `tenantId` as `resourceId`.

**Status: ✅ DONE**

---

### 8. Multi-Tenant Isolation

**What it means:** Tenant A never touches tenant B.

**Evidence:** `apps/relay/src/index.ts:57-60` — hard refusal to cross-tenant route. `apps/mcp-server/src/gateway.ts:97-113` — tools filtered by tenant's active integrations.
**Mastra memory:** Memory isolation via `resource: tenantId` in every `agent.generate()` call. PostgresStore queries include resourceId in all lookups.
**Mastra tools (isolation fix — 9238a58):** `apps/relay/src/mastra/tools.ts` — `getMCPClientForTenant(tenantId)` creates a new MCPClient per task with both `x-internal-service-key` (auth) and `x-tenant-id: tenantId` (credential scoping) headers. Previous singleton pattern shared one connection across all tenants — removed. MCPClient disconnected in `try/finally` in `workflow.ts` on every exit path.

**Status: ✅ DONE**

**Gaps:**
- MCP server is shared Node.js process — logical isolation only
- Internal routes unauthenticated at API Gateway level

---

### 9. Observability

**What it means:** Every token, tool call, and cost tracked.

**Evidence:** `apps/relay/src/index.ts:302-373` — per-turn metrics, RAG metrics, tool call logs, knowledge gap logs. `apps/relay/src/usage.ts:75-93` — three rows per turn in usage_records.
**Mastra path:** `mastra_ai_spans` table receives execution traces. Wiring to Langfuse is Phase 2 work.

**Status: ✅ DONE**

**Gaps:**
- No distributed trace ID linking frontend → Lambda → relay → Mastra/OpenClaw → MCP
- `traceId` sent by taskWorker but ignored in relay
- `mastra_ai_spans` populated but not wired to observability dashboard yet

---

### 10. Human in the Loop

**What it means:** Approval gates before irreversible actions.

**Evidence:** `apps/relay/src/index.ts:1703-1769` — exec approval intercept. Task state machine has `awaiting_approval` that blocks execution.
**Mastra path:** `onTaskComment` callback in WorkflowContext routes `needs_clarification` status to `POST /internal/tasks/{id}/clarify`, which sets task to `awaiting_clarification` state. Execution stops and waits for user.

**Status: ✅ DONE — Task board**
**Status: 🟡 PARTIAL — Chat**

**Gap:** MCP write tools (gmail_send, calendar_create, zoho_mail_send) have no hard programmatic gate — only LLM instruction via IDENTITY.md. If model misinterprets, tool fires.

---

### 11. Stateful Sessions

**What it means:** Context persists across conversations and restarts.

**Evidence (chat):** `apps/relay/src/persistence.ts` — DB-backed. `apps/agent-server/index.ts:260` — OpenClaw session files on disk per container.
**Evidence (Mastra):** Full DB-backed memory — `mastra_threads`, `mastra_messages`, `mastra_resources` in Neon. Relay restart does not lose Mastra session context.

**Status: ✅ DONE**

**Gap (chat only):** If container destroyed and reprovisioned, OpenClaw in-memory session resets. DB history re-injected but internal reasoning context lost.

---

### 12. Agent Workflows (Proactive)

**What it means:** Agents triggered by events, schedules, data changes — not just user messages.

**Evidence:** `packages/foundation/database/schema/agents.ts:35-50` — `agentWorkflows` table with trigger enum: `['incident_created', 'scheduled', 'manual']`.
**Mastra path:** `mastra_schedules` table available for scheduled workflow execution. Wiring to `agentWorkflows` table is Phase 2 work.

**Status: 🟡 PARTIAL**

**Gap:** Schema and data model complete. Manual trigger (task system) works. `mastra_schedules` exists but not yet wired to `agentWorkflows` trigger execution. No EventBridge rule for scheduled triggers.

---

### 13. Sandboxed Execution

**What it means:** Per-tenant execution boundary — cannot access other tenants' data.

**Evidence (chat):** `apps/agent-server/index.ts:87-90` — Docker container per tenant. Port range 19000-19999.
**Evidence (Mastra):** Memory isolation via `resourceId = tenantId`. No per-tenant process — logical isolation only (same tradeoff as MCP server).

**Status: 🟡 PARTIAL**

**Gap:** `provision.sh` on GCP VM (not in repo) — cannot verify seccomp, capability drops, read-only rootfs. Mastra uses logical tenant isolation, not process isolation.

---

### 14. Privacy Router

**What it means:** PII stripped before LLM call.

**Evidence:** `apps/relay/src/pii-filter.ts:116-144` — 14 Indian PII patterns. Applied to user messages and task inputs (Phase 1 fix applied).
**Mastra path:** PII filtering happens at the HTTP handler level in `app.ts` BEFORE `runMastraTaskSteps()` is called. Mastra receives already-sanitized inputs.

**Status: ✅ DONE**

**Note:** `pii-filter.ts` is permanent. Indian PII patterns (Aadhaar, PAN, phone numbers) are better handled here than by any upstream framework.

---

### 15. Intent Verification

**What it means:** Validate what agent wants to do BEFORE it does it.

**Evidence:** `apps/relay/src/openclaw.ts:433-443` — exec approval for shell/code tools. Task state machine — plan must be approved before execution.
**Mastra path:** `needs_clarification` status in structured output triggers `onTaskComment` → task pauses → user responds before execution resumes.

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
| 3e | Memory Working | ❌ | ✅ | 🟡 |
| 4 | Planning | N/A | ✅ | ✅ |
| 5 | Tool Calling Reliability | ✅ | 🟡 | 🟡 |
| 6 | Multi-LLM | ✅ | ✅ | ✅ |
| 7 | Per-Tenant Config | ✅ | ✅ | ✅ |
| 8 | Multi-Tenant Isolation | ✅ | ✅ | ✅ |
| 9 | Observability | ✅ | 🟡 | 🟡 |
| 10 | Human in the Loop | 🟡 | ✅ | 🟡 |
| 11 | Stateful Sessions | 🟡 | ✅ | 🟡 |
| 12 | Agent Workflows | ❌ | 🟡 | 🟡 |
| 13 | Sandboxed Execution | 🟡 | 🟡 | 🟡 |
| 14 | Privacy Router | ✅ | ✅ | ✅ |
| 15 | Intent Verification | 🟡 | ✅ | 🟡 |

---

## Deterministic vs Probabilistic Map

This is critical for selling agents. What is reliable vs what varies.

| Decision Point | Currently | Should Be | Risk |
|---|---|---|---|
| Which tool to call per step | PROBABILISTIC — LLM picks | Deterministic — verify after | Wrong tool, wrong data |
| Step output format | DETERMINISTIC ✅ — Mastra structuredOutput enforces schema | Same | — |
| Task state transitions (user) | DETERMINISTIC ✅ | Same | — |
| Task state transitions (agent) | STRUCTURED — Mastra status field drives transitions | Same | — |
| RAG chunk selection | DETERMINISTIC — score threshold + correct sort order | Same | — |
| When step is done | DETERMINISTIC ✅ — Mastra status: "done" field | Same | — |
| Billing quota enforcement | DETERMINISTIC ✅ — quota re-checked in runMastraTaskSteps | Same | — |
| Planning step count cap | DETERMINISTIC ✅ | Same | — |
| Clarification round limit | DETERMINISTIC ✅ | Same | — |
| Tool availability per tenant | DETERMINISTIC ✅ | Same | — |

**The rule:** LLM layer is probabilistic — that is correct. Everything around it must be deterministic. Control flow, output validation, state transitions, quota enforcement — all deterministic code, not LLM decisions.

**Phase 2 improvement:** Mastra's `structuredOutput: { schema: StepOutputSchema }` enforces Zod schema on every step output. Status field (`done | needs_clarification | failed`) replaces the old regex-based detection.
