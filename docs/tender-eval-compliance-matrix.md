# Tender & Procurement Evaluation — Compliance Matrix

**Submission:** EOI demo · Monday 2026-06-08  
**Route:** `/[tenant]/dashboard/tender-evaluation`  
**Tender:** MP-DIT/HRMS/2024-25/001 — HRMS Procurement, Dept of IT, Govt. of Madhya Pradesh

---

| # | Evaluation Parameter | Status | Capability Description | Demo Screen |
|---|---------------------|--------|----------------------|-------------|
| 1 | **Bid Preparation — RFP/Tender Authoring & Structuring** | ✅ Qualified | Platform maintains a structured clause library from which RFP clauses are composed. Eligibility criteria thresholds, SLA definitions, and BOQ templates are AI-drafted and version-controlled (v1 → published v2). The full tender document history is traceable. | Stage 1 tab → "Authoring (Assisted)" flashback panel showing clause count, v1→v2 version badge, and structured output |
| 2 | **Pre-Bid Query Management & Corrigendum Handling** | ✅ Qualified | Platform captures all pre-bid queries, AI-drafts responses for officer review, and issues version-controlled corrigenda. Each corrigendum records clause-level diffs (from → to). Three queries and one corrigendum are shown with full amendment history. | Stage 2 tab → "Pre-Bid" flashback panel showing corrigendum with clause diff, and 3 responded pre-bid queries |
| 3 | **Pre-Qualification (PQ) Evaluation** | ✅ Qualified | Automated PQ scrutiny against 4 GFR 2017 eligibility criteria (turnover, similar work, OEM auth, no-blacklisting) using a deterministic JSON rule engine. At least one bidder (TechAxis/Bidder B) fails on turnover with exact declared vs. required values and source doc+page cited. All results persist to DB with full provenance. | Stage 3 tab → PQ panel — per-bidder Qualified/Not-Qualified summary, rule findings with declared ₹3.2 Cr vs ₹5 Cr threshold, source doc "Audited Balance Sheet, p.4" |
| 4 | **Technical Evaluation & Compliance Assessment** | ✅ Qualified | Clause-wise compliance assessment across 8 RFP clauses runs **live** against the inference gateway (Gemini via vertex-proxy). Each clause receives Complied/Deviation/Not-Found status with page-level source citation. A comparative technical statement is built from results. No bidder document leaves the platform — all processing is via the self-hosted inference gateway. | Stage 4 tab → "Run Live Evaluation" button → live model call (~10–30s) → clause-wise compliance sheet with status badges and source citations; deviations on Cl 3.9 (response time) and Cl 5.1 (biometric protocol) |
| 5 | **Shortfall Identification & Clarification Management** | ✅ Qualified | System automatically identifies technical deviations and drafts CVC-compliant clarification requests: time-bound (7 working days), no price modification, no substance change. Clarification for InfraVision Clause 5.1 (biometric protocol ambiguity) is auto-drafted and shown with full audit trail. Response tracking is built in. | Stage 5 tab → Shortfall panel — discrepancy text, source doc+page, auto-drafted clarification request blockquote with CVC-clean framing, 7-day deadline |
| 6 | **Financial Evaluation & Report Generation** | ✅ Qualified | BOQ comparison table across qualified bidders (InfraVision ₹7.82 Cr, NovaSys ₹8.15 Cr) with L1 determination and arithmetic correction column. One-click consolidated evaluation report generated with PQ/Technical/Financial summaries and a plain-language recommendation. Officer Accept/Override/Escalate controls on the report with mandatory rationale for Override/Escalate. | Stage 6 tab → BOQ comparison table → L1 banner (InfraVision ★L1), corrected totals → Evaluation Report card → officer action buttons |

---

## Human-in-the-loop Controls (all 6 stages)

Every finding across PQ, Technical, and Financial stages exposes:
- **Accept** — logs officer decision, writes tamper-evident audit trail
- **Override** — requires written rationale, logs to `tender_officer_actions` + audit log  
- **Escalate** — requires written rationale, routes to senior officer

No AI verdict is final. The officer owns every decision. Source doc + page is shown on every finding.

---

## Confidentiality Guarantee

All document processing routes through the **self-hosted inference gateway** (`apps/inference-gateway`, vertex-proxy at `:4001` → Vertex AI). No bidder document is sent to any external public LLM endpoint. This is enforced at the relay layer — the `INFERENCE_GATEWAY_URL` env var points only to `localhost:4001`.

---

## Key Files

| Component | Path |
|-----------|------|
| Schema | `packages/foundation/database/schema/tender.ts` |
| PQ rule engine JSON | `apps/ai-service/rules/tender/tender_pq_rules.json` |
| PQ rule evaluator | `apps/relay/src/mastra/rules/tenderPqRules.ts` |
| Mastra workflow (5 steps) | `apps/relay/src/mastra/workflows/tenderEvaluationWorkflow*.ts` |
| API routes (Lambda) | `apps/api/src/routes/tender.ts` |
| Relay routes | `apps/relay/src/routes/tender.ts` |
| Dashboard route (UI) | `apps/web/app/[tenant]/dashboard/tender-evaluation/` |
| Seed script | `scripts/seed_tender_demo.ts` |
