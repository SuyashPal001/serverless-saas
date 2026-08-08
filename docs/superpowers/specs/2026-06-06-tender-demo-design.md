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

## Walkthrough refinements — gaps found in officer role-play (2026-06-06)

A step-by-step role-play (Claude as demo presenter, user as a non-technical procurement officer)
surfaced 6 gaps. These are **binding additions** to the design — build these, not the v1 simplification.

### GAP 1 — Tender worklist / home (don't open on a single tender)
Officers manage *many* tenders at different stages. The app home is a **Tender Worklist**: a list of
all tenders, each with a **stage badge** (Draft → Published → Pre-Bid → Bids Received → PQ →
Technical → Financial → Awarded) and a "pending with you" column. Clicking a row opens that tender's
**workspace at its current stage**. For the demo only the IT-Infra tender is fully functional; 4–5
other rows are realistic static context. (See sample worklist in §UI below.)

### GAP 2 — Overview + Document Room before any evaluation
The tender workspace has tabs: **Overview · Documents · Evaluation**, landing on Overview.
- **Overview** = plain-language AI digest of the tender doc: what's being procured, value, mode, key
  dates, eligibility-in-brief, evaluation method. Every line links to its RFP clause + page.
- **Documents** = organized document room (not a folder dump), see GAP 3 for layout. Opening any
  document shows the AI's extracted highlights pinned (turnover figure, spec table, etc.).
Officer orients *first*, evaluates second.

### GAP 3 — Two-sided document model ("yardstick vs measured")
Keep the formal labels **"Tender Documents"** and **"Bid Submission"**, but lay them out as two clear
sides so a non-technical officer never confuses them:
- **Tender Documents** (left) = *what WE asked for* — RFP, corrigenda, PQ criteria, specs, BOQ
  format, forms. The **yardstick**. Issued by us.
- **Bid Submission** (right) = *what THEY offered* — each bidder's bundle, kept separate, split into
  🔓 Technical envelope and 🔒 Financial envelope. Gets **measured** against the yardstick.

### GAP 4 — Confirm-the-criteria step (guard against silent mis-extraction)
Before each evaluation run, show the criteria the system extracted from the RFP (one line each, with
clause + page) and require the officer to **Confirm** (or Edit). Prevents an OCR/extraction error
(e.g. "₹6 Cr" read as "₹6 L") from silently corrupting every result, and puts the officer's sign-off
on the yardstick on record.

### GAP 5 — Chat architecture: structured findings + RAG, scoped (NOT raw documents)
A naive "feed all documents to the model" chat fails (context limits). The tender chat is a
**tool-using agent with two sources**, and runs **after** evaluation so structured findings exist:
1. **Structured findings (Postgres)** — the extracted per-bidder fields and compliance/PQ/financial
   tables. Powers **comparison / aggregate** questions (complete, deterministic, every bidder/field).
   Free-form RAG is *unreliable* for these and must NOT be the path for comparisons.
2. **Hybrid RAG retrieval** (existing pipeline) — for open-ended "what/where does bidder X say"
   lookups; cites doc + page. Exhaustive-negative questions ("did A mention delivery anywhere?")
   report "no firm commitment found in indexed content + closest match"; never claim a perfect negative.

The agent picks the tool per question. **For the demo, scope the chat to a fixed set of supported
questions**, each pre-verified against real seeded findings (open-ended chat is the highest live-demo
risk). Demo-supported set:
1. Warranty offered vs required (Bidder A) — findings
2. Compare A and C on key specs — findings
3. Why did Bidder B fail PQ — PQ findings + citation
4. Where does Bidder A mention delivery timeline — RAG, honest closest-match
5. Summarize Bidder C's bid — RAG over C's docs

### GAP 6 — Neutral decision support: NEVER recommends a bidder (ABSOLUTE RULE)
For the final award trade-off (e.g. L1 bidder with technical deviations vs pricier fully-compliant
bidder), the chat is a **neutral advisor**: it lays out facts, trade-offs, risks, and rule
implications for each option with citations, names the factual questions that decide it, then **hands
the decision back**. It is **hard-constrained to never recommend or name a preferred bidder**, even
when asked directly ("which should I pick?" → declines, offers to surface more facts instead). This
is an absolute guardrail — bias/audit liability if violated. Reinforces "human owns the verdict."

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
- `tender_chat` (or reuse existing `conversations`) — scoped chat threads per tender
- `extracted_criteria` — PQ/spec criteria parsed from the RFP, with confirm-state (GAP 4)
- `bidder_fields` — structured per-bidder extracted values (turnover, warranty, delivery, BOQ
  totals…) that the chat's structured-findings tool queries (GAP 5)

### Workflow — `tenderEvaluationWorkflow` (Mastra)
Steps mapping to stages 3–6 (1–2 are lighter assist features):
`ingest_bids` → `pq_evaluate` → `technical_evaluate` → `shortfall_detect` →
`financial_evaluate` → `report_assemble` → `route_to_officer`.
Reuse `documentIntelligenceAgent` (Tier 3) for OCR/extraction as ITR does.

### UI — new dashboard route (sibling to `apps/web/app/[tenant]/dashboard/pension-review`)
Suggested: `tender-evaluation` (or `bid-evaluation`). Surfaces (revised per role-play GAPs):
- **Tender Worklist (home)** — all tenders, each with a **stage badge** + "pending with you"; click
  a row → workspace at its current stage. Only IT-Infra tender is functional; others static. (GAP 1)
- **Tender workspace** with tabs **Overview · Documents · Evaluation**:
  - **Overview** — plain-language AI digest, every line linking to RFP clause + page. (GAP 2)
  - **Documents** — two-sided room: **Tender Documents** (yardstick) | **Bid Submission** (measured,
    🔓 technical / 🔒 financial). Open a doc → pinned AI highlights. (GAP 2, 3)
  - **Evaluation** — 6-stage lifecycle (stepper). Each run preceded by **Confirm-the-criteria** (GAP 4):
    - **PQ panel**: per-bidder Qualified/Not-Qualified with cited evidence.
    - **Technical panel**: clause-wise compliance (Complied/Deviation/Not Found + page cite) +
      comparative statement; hosts the **live run**. Not-Found never guesses.
    - **Shortfall panel**: discrepancies + auto-drafted CVC-clean clarification + response tracking.
    - **Financial panel**: sealed-until-qualified envelopes (failed bidder's never opens) → BOQ
      comparison → arithmetic correction → L1 with price-vs-compliance trade-off surfaced.
    - **Report**: one-click consolidated evaluation report (PQ/Technical/Financial).
- **Tender chat panel** (docked) — scoped to current tender; tool-using agent over structured
  findings + RAG; runs after evaluation; demo-scoped question set; **neutral, never recommends a
  bidder**. (GAP 5, 6)
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
