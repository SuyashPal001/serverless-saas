# VM Implementation Prompt — Tender & Procurement Evaluation Demo

> Paste this to the Claude Code VM session running against this repo.
> Full design: `docs/superpowers/specs/2026-06-06-tender-demo-design.md` (READ IT FIRST).

---

You are implementing a time-boxed demo (submission **Monday 2026-06-08**) in this repo. Build a
**government tender/procurement evaluation demo** that takes ONE real IT-procurement tender through
all **6 bid-lifecycle stages** in the existing web dashboard, reusing the AI-PARAS / ITR-audit agent
foundation. Each stage is a thin "glimpse" slice — not a full feature. **The win is recognition:** a
government procurement officer must look at it and think "that's my desk, and it did the painful part
without me pasting a confidential bid into ChatGPT."

## Before you write anything

1. Read `docs/superpowers/specs/2026-06-06-tender-demo-design.md` end to end. It is the contract.
2. Read these for patterns to mirror exactly:
   - `docs/superpowers/specs/2026-05-27-ai-paras-design.md` and the **AI-PARAS implementation**
     (workflow, schema, officer-review UI). This is your template.
   - `docs/superpowers/specs/2026-05-29-itr-audit-agent-design.md` (cross-reference + rule-engine pattern).
   - `packages/foundation/database/schema/pension.ts` (schema shape to mirror in `tender.ts`).
   - `apps/web/app/[tenant]/dashboard/pension-review/` (UI route + officer Accept/Override/Escalate).
   - The Mastra workflow(s), `documentIntelligenceAgent`, the inference gateway OCR path, and the RAG
     pipeline (hybrid search + contextual embeddings). Find them; reuse them. Do not reinvent OCR,
     retrieval, agent runtime, or LLM routing.
3. Use the brainstorming-derived plan; if a `writing-plans` plan file exists for this, follow it.
   Use TDD where it doesn't slow the demo-critical path unreasonably.

## What to build

**Schema** — `packages/foundation/database/schema/tender.ts`, mirroring `pension.ts`. Tables:
`tenders`, `tender_clauses`, `corrigenda`, `prebid_queries`, `bidders`, `bids`, `pq_findings`,
`technical_findings`, `shortfalls`, `clarification_requests`, `financial_findings`,
`evaluation_reports`, `officer_actions`. Postgres-first. (Field-level detail in the design doc.)

**Rule engine** — `tender_pq_rules.json` (pattern of `it_act_rules.json`): PQ eligibility rules
(turnover threshold, similar-work experience, OEM authorization, no-blacklisting).

**Workflow** — `tenderEvaluationWorkflow` (Mastra): `ingest_bids` → `pq_evaluate` →
`technical_evaluate` → `shortfall_detect` → `financial_evaluate` → `report_assemble` →
`route_to_officer`. Reuse `documentIntelligenceAgent` for extraction.

**UI** — new dashboard route sibling to `pension-review` (suggest `tender-evaluation`):
- First screen = **evaluation cockpit**: tender header, 3 bidders, prominent **Run Evaluation**.
- 6-stage lifecycle view. Stages 1–2 (authoring/pre-bid + corrigendum) shown as lighter "we assist
  here too" flashback panels with version control (v1→v2). Stages 3–6 are the substance.
- **PQ panel**: per-bidder Qualified/Not-Qualified + cited evidence (doc + page).
- **Technical panel**: clause-wise compliance sheet (Complied / Deviation / Not Found, each with page
  citation) + comparative technical statement. **This panel hosts the LIVE run.**
- **Shortfall panel**: discrepancies + auto-drafted clarification request (CVC-clean: time-bound, no
  substance change) + response tracking.
- **Financial panel**: BOQ comparison table + L1 determination.
- **Report**: one-click consolidated PQ/Technical/Financial evaluation report.
- Officer **Accept / Override / Escalate** (rationale required for Override/Escalate) throughout.
  Source attribution (doc + page) on every finding.

## Liveness (critical)

Stages 1, 2, 3, 5, 6 are **pre-processed / seeded** — show as results. **Stage 4 (Technical
Evaluation) runs the model live** on one real bidder document via the existing inference gateway
(~10–30s acceptable). Keep PQ (stage 3) runnable live too as a fallback.

## Sample data

The user will provide 1 real IT tender (RFP) + 2–3 bidder docs (scanned PDFs OK → OCR via gateway).
**At least one bidder must fail PQ** (e.g. turnover below threshold) and **at least one document must
be ambiguous/missing** to trigger a clarification. If real bidder docs are not provided, synthesize
realistic bidder responses around the real tender with those planted shortfalls. Provide a seed
script (pattern: `scratch/seed_paras_agent.ts`).

## Hard constraints

- **No bidder document leaves the platform to any external/public LLM.** Use the existing inference
  gateway only. This is the product's core pitch — do not violate it.
- Do NOT build CPPP/GeM portal integration; the demo's entry point is a manual pull-in.
- Domain defaults: GFR 2017, two-bid (Technical + Financial), L1 award basis. Don't build QCBS math
  beyond a simple configurable weight.
- No AI verdict is final — human officer owns every verdict.
- Follow existing repo conventions, auth, and layout. Don't refactor unrelated code.

## Done = acceptance criteria (from design doc §Acceptance criteria)

1. New route renders the cockpit for one seeded IT tender + 3 bidders.
2. All 6 stages produce visible plausible output (5 seeded, stage 4 live).
3. Stage 4 runs live and yields a clause-wise compliance sheet with page-level citations.
4. ≥1 bidder fails PQ (cited) and ≥1 shortfall yields an auto-drafted clarification.
5. Financial stage yields a BOQ comparison + determined L1.
6. Officer can Accept/Override/Escalate; every finding shows source doc + page.
7. No bidder doc sent to an external public LLM.
8. **Compliance-matrix doc** produced: 6 parameters × {Qualified, 1–2 line description, demo-screen
   pointer}. Save to `docs/` and reference in the final summary.
9. Build passes; route reachable in local dev. Report exact run/verify commands.

## Report back

When done, return: (a) files changed, (b) the run/verify commands, (c) the compliance-matrix doc
path, (d) anything that deviates from the design doc and why, (e) known gaps / risks for Monday.
