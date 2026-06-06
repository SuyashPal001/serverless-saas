# Tender & Procurement Evaluation — Demo Design Spec

**Status:** Design approved (domain + narrative locked). Implementation to be executed by a separate Claude VM session against this repo.
**Date:** 2026-06-06
**Deadline:** Submission Monday 2026-06-08
**Related:** `2026-05-27-ai-paras-design.md` (pattern source), `2026-05-29-itr-audit-agent-design.md`

---

## Purpose

Demonstrate AI-enabled capability across the **full government bid/tender lifecycle** for an
EOI/tender compliance matrix (6 evaluation parameters). One real IT-procurement tender flows
through all six stages in a new dashboard route, reusing the AI-PARAS agent / RAG / officer-review
foundation. Each stage is a thin but real "glimpse" slice — not a full feature build.

**The wow is recognition, not novelty.** The target evaluators already run this process manually.
The demo must make them think: *"that's literally my desk — and it did the painful part without me
pasting a confidential bid into ChatGPT."*

Two deliverables:
1. **Working demo** in `apps/web` (dashboard route, sibling to `pension-review`).
2. **Compliance-matrix document** marking all 6 parameters *Qualified*, each with a 1–2 line
   capability description + pointer to the demo screen that proves it. This is the submission artifact.

---

## The 6 evaluation parameters (source matrix)

| # | Parameter | Required capability (from matrix) |
|---|-----------|-----------------------------------|
| 1 | **Bid Preparation (RFP/Tender Authoring & Structuring)** | Clause library, standardized templates, eligibility criteria drafting, SLA/KPI formulation, evaluation frameworks, document version control |
| 2 | **Pre-Bid Query Management & Corrigendum Handling** | Capture/manage/respond to pre-bid queries; automated response drafting; version-controlled corrigenda issuance |
| 3 | **Pre-Qualification (PQ) Evaluation** | Automated eligibility assessment against PQ criteria; document verification; compliance validation; qualification status |
| 4 | **Technical Evaluation & Compliance Assessment** | Clause-wise technical bid evaluation; automated compliance mapping; configurable scoring; comparative technical evaluation statement |
| 5 | **Shortfall Identification & Clarification Management** | System-driven discrepancy/shortfall identification; automated clarification requests; response tracking; complete audit trails |
| 6 | **Financial Evaluation & Report Generation** | Financial bid analysis incl. BOQ comparison; L1 determination; automated stage-wise evaluation reports (PQ/Technical/Financial) |

---

## Domain model (locked assumptions)

Indian government procurement under **GFR 2017**. **Two-bid system** (Technical + Financial
envelopes). **L1** as award basis. Goods + services procurement. Mandated portal (CPPP/GePNIC or
GeM) remains the system of record — our product does **not** replace it.

**Real lifecycle being modeled:**
indent → estimate/approval → tender drafting (scope, PQ criteria, specs, BOQ, SLA, eval method) →
publish/NIT → pre-bid meeting (queries → corrigendum) → bid submission (two-envelope) →
technical bid opening → PQ scrutiny → technical evaluation (TEC, clause compliance, scoring) →
shortfall/clarification (CVC-clean: time-bound, no substance change) → financial bid opening
(qualified only) → BOQ compare → arithmetic correction → L1 → comparative statement / report →
recommendation → award.

---

## Entry point & narrative (locked)

**Product entry point = the evaluation seam, NOT "we are the portal."**
The officer tenders and receives bids on their mandated portal as always, then pulls the tender +
opened bids into our system to do the hard thinking, and pushes the decision/report back into their
file. This is the honest integration point and the entire moat in one line: *confidential bids never
leave the platform / never go to a public AI.*

**Demo first screen = the evaluation cockpit (land in the pain).**
Opens on: *"Tender for Supply & Implementation of [IT system] — 3 bids received, opened today,"*
three bidders, a prominent **Run Evaluation** affordance. Stages 1–2 (authoring/pre-bid) are shown
via flashback ("this tender was also drafted/amended here") so the lifecycle is complete but the
hook is the evaluation pain.

**The one-breath narrative:**
> Officer opens the evaluation cockpit for a real IT tender, 3 bids in. **PQ scrutiny** runs → one
> bidder fails on turnover (audited-statement page cited). **Technical evaluation runs live** →
> clause-wise compliance + comparative statement, deviations flagged with citations. System
> **auto-drafts a clarification** for an ambiguous bidder doc (CVC-clean). Financial envelopes of
> qualified bidders open → **BOQ compare → L1 determined** → one-click **evaluation report**. Every
> finding cites its source; the officer **Accepts/Overrides/Escalates** — AI never decides.

**Liveness:** Stages 1, 2, 3, 5, 6 pre-processed and shown as results. **Stage 4 (Technical
Evaluation) runs live** on one bidder's real document — the authenticity proof. Live model call is
acceptable (~10–30s). PQ (stage 3) is the documented fallback live stage if needed.

---

## Sample data (user provides real docs)

- **1 real IT tender** (RFP) — user supplies. Scanned PDFs OK (OCR via inference gateway).
- **2–3 bidder submissions** ("Bidder A/B/C") — at least **one with intentional shortfalls** so
  stages 3–5 have something to find (e.g. turnover below PQ threshold; a technical deviation; one
  missing/ambiguous document requiring clarification).
- If real bidder docs are unavailable, the VM synthesizes realistic bidder responses around the real
  tender (planted shortfalls as above).

---

## Human-in-the-loop (non-negotiable — matches CAG framing)

No AI verdict is final. PQ / technical / financial findings route to an officer for
**Accept / Override / Escalate** (Override + Escalate require rationale). Every input value links to
its **source document + page**. Full audit trail. Same contract as AI-PARAS / ITR audit agents.

---

## Architecture & reuse (the speed story)

Mastra is the backbone (workflow orchestration, step I/O, tool-calling, agent runtime, LLM routing),
same as the ingestion / pension / ITR workflows. We supply the tender domain content.

| Concern | Reuse from |
|---------|-----------|
| Document OCR / ingestion | Inference gateway (Gemini vision) — same path as pension ingestion |
| Retrieval / grounding | Existing RAG pipeline (hybrid search + contextual embeddings) — clause retrieval, bid grounding |
| Workflow / agent runtime | Mastra (same pattern as AI-PARAS `*Workflow`, ITR `itrWorkflow`) |
| Deterministic eligibility | Rule-engine JSON pattern (like `it_act_rules.json`) → `tender_pq_rules.json` |
| Officer review UI | `pension-review` route pattern: queue + Accept/Override/Escalate + source attribution |
| Schema | New `tender.ts` in `packages/foundation/database/schema`, mirroring `pension.ts` |

### New schema — `packages/foundation/database/schema/tender.ts`
Mirror the `pension.ts` shape. Tables (Postgres-first):
- `tenders` — tender_id, title, sections, eval_method (L1/QCBS), version
- `tender_clauses` — clause library entries (for stage 1)
- `corrigenda` — version-controlled amendments (stage 2)
- `prebid_queries` — query, drafted_response, status (stage 2)
- `bidders` / `bids` — bid_id, tender_id, bidder_name, envelope, document_ids
- `pq_findings` — per-bidder eligibility findings + source attribution (stage 3)
- `technical_findings` — clause-wise compliance + score + source attribution (stage 4)
- `shortfalls` / `clarification_requests` — discrepancy + drafted request + response tracking (stage 5)
- `financial_findings` — BOQ line comparison, arithmetic correction, L1 flag (stage 6)
- `evaluation_reports` — consolidated PQ/Technical/Financial report (stage 6)
- `officer_actions` — Accept/Override/Escalate + rationale (all stages)

### Workflow — `tenderEvaluationWorkflow` (Mastra)
Steps mapping to stages 3–6 (1–2 are lighter assist features):
`ingest_bids` → `pq_evaluate` → `technical_evaluate` → `shortfall_detect` →
`financial_evaluate` → `report_assemble` → `route_to_officer`.
Reuse `documentIntelligenceAgent` (Tier 3) for OCR/extraction as ITR does.

### UI — new dashboard route (sibling to `apps/web/app/[tenant]/dashboard/pension-review`)
Suggested: `tender-evaluation` (or `bid-evaluation`). Surfaces:
- **Evaluation cockpit** (first screen): tender header, 3 bidders, Run Evaluation.
- **6-stage lifecycle view**: stage tabs/timeline; stages 1–2 as flashback panels.
- **PQ panel**: per-bidder Qualified/Not-Qualified with cited evidence.
- **Technical panel**: clause-wise compliance sheet (Complied/Deviation/Not Found + page cite) +
  comparative technical statement; this panel hosts the **live run**.
- **Shortfall panel**: discrepancies + auto-drafted clarification requests + tracking.
- **Financial panel**: BOQ comparison table + L1 determination.
- **Report**: one-click consolidated evaluation report (PQ/Technical/Financial).
- Officer controls (Accept/Override/Escalate) throughout; source attribution everywhere.

---

## Out of scope (YAGNI for Monday)

- Replacing/integrating live with CPPP/GeM portal APIs (entry point is manual pull-in for the demo).
- QCBS scoring math beyond a simple configurable weight (L1 is the demo path).
- Full clause-library authoring UX for stage 1 (glimpse: draft eligibility + one SLA clause, show v1→v2).
- Multi-tenant hardening / production auth beyond reusing existing dashboard auth.
- Iceberg/Delta freeze for the legal trail (Postgres-first; note as follow-up, don't build).

---

## Acceptance criteria (what the VM must deliver)

1. New dashboard route renders the evaluation cockpit for one seeded IT tender with 3 bidders.
2. All 6 stages produce visible, plausible output (5 pre-processed/seeded, stage 4 runs live).
3. Stage 4 technical evaluation runs the model live on one real bidder doc and produces a
   clause-wise compliance sheet with at least page-level source citations.
4. At least one bidder fails PQ (cited reason) and at least one shortfall produces an auto-drafted
   clarification request.
5. Financial stage produces a BOQ comparison and a determined L1.
6. Officer can Accept/Override/Escalate on findings; every finding shows source doc + page.
7. No bidder document is sent to any external public LLM endpoint (uses existing inference gateway).
8. Compliance-matrix doc produced: 6 params × {Qualified, 1–2 line description, demo-screen pointer}.
9. Build passes; route reachable in local dev.
