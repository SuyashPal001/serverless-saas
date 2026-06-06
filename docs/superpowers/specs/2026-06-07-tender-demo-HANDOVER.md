# Tender/Procurement Demo — HANDOVER (source of truth)

**Date:** 2026-06-07 · **Branch:** `develop` · **Status:** build exists but is a SHELL — must be made real.
This doc is the single source of truth. Read it top to bottom before doing anything. It supersedes
loose chat context.

Related docs (same folder):
- `2026-06-06-tender-demo-design.md` — full design + the 7 walkthrough gaps (the EXPERIENCE spec)
- `2026-06-06-tender-demo-VM-prompt.md` — original VM prompt (now PARTLY OBSOLETE; see §7)
- `docs/tender-eval-compliance-matrix.md` — compliance matrix artifact (VM-generated)
Memory: `mpsedc-procurement-demo.md` (project memory).

---

## 1. TL;DR / current status

- We are bidding for **MPSEDC (MP State) on-prem Generative AI Procurement Platform**.
- A demo was built by a VM (commits `f9dbd17`, `6bb8960`, etc. on `develop`): a `tender-evaluation`
  dashboard route + Mastra `tenderEvaluationWorkflow` + schema + seed + compliance matrix.
- **CRITICAL PROBLEM:** the build is a **shell**. The "AI" is scripted, no documents are ingested,
  it defaults to cloud Gemini, and the live run 401s. It would be **disqualified in minute one**
  under MPSEDC's grading. See §4 for evidence.
- **Plan:** two phased prompts — **P1** make the engine genuinely real on ONE stage (§7), then
  **P2** scale to all 6 stages + the walkthrough experience (§8).
- **Working mode:** Claude (this assistant) produces **specs + prompts only**. A separate Claude VM
  implements. The user does NOT want Claude editing code in this thread.

---

## 2. What we're bidding for (authoritative scope)

Source: `Scope-of-work-MP-procurement (1).pdf` (user's Downloads, 4 pp). MPSEDC wants a **COTS
Generative AI Procurement Platform deployed on-prem at MP State Data Centre** (no public cloud
without approval; data stays in govt infra).

**10 scope sections:** (1) AI RFP/tender preparation; (2) document ingestion (OCR scanned PDFs,
Word/PDF, extract eligibility/specs/timelines/eval params, corrigendum versioning); (3) **AI
Evaluation Criteria Generation** (auto-generate PQ/technical/commercial criteria + scoring matrix +
weightages, human review); (4) PQ evaluation; (5) technical evaluation (AI scoring, compliance
mapping, comparison, shortfall, evaluator overrides); (6) financial evaluation (BOQ parsing, price
normalization, **L1/L2/L3**, **award recommendation generation**); (7) audit & reporting (audit
trail, **RBAC**, PDF/Excel export, dashboard, logs); (8) on-prem deployment (MP SDC, 99.5% uptime,
≤3s response); (9) training (roles: Procurement Officer, Evaluator, Approver, System Admin);
(10) security (ISO 27001, CERT-In, VAPT, **human approval mandatory for AI outputs**, **no external
AI APIs unless govt-controlled**).

**HOW THEY GRADE (existential):** MPSEDC provides **5 real completed tenders** (RFP, corrigenda,
bids, final evaluation outputs). Our AI runs all 6 workflow stages and they **compare AI results vs
the actual historical outcomes** (PQ qualified/not, technical compliance + scoring, deficiencies,
clarifications, L1/L2/L3, final reports). **Must be "Qualified" in ALL 6 — fail one = DQ.** Must be
a **live working solution; presentation-only/PPT not accepted.** ⇒ The bar is **accuracy vs ground
truth on real documents**, not a good-looking mock.

**What "Monday" is:** proposal submission + a working demo on OUR sample tender (the HRMS tender).
The 5-real-tenders comparison is the later MPSEDC evaluation stage.

---

## 3. Architecture (how a real run flows)

```
web (apps/web/app/[tenant]/dashboard/tender-evaluation/)
  → api  (apps/api/src/routes/tender.ts)            [sends x-internal-service-key]
    → relay (apps/relay/src/routes/tender.ts)        [checks key → 401 if mismatch]
      → Mastra workflow (apps/relay/src/mastra/workflows/tenderEvaluationWorkflow.*.ts)
        → inference-gateway (apps/inference-gateway/) [adapters: ollama, anthropic, vertex]
          → model
Ingestion: existing AI-PARAS pipeline via relay /internal/ingest (reuse — do NOT reinvent OCR).
```

Key built files:
- Schema: `packages/foundation/database/schema/tender.ts`
- Rules: `apps/ai-service/rules/tender/tender_pq_rules.json`, `apps/relay/src/mastra/rules/tenderPqRules.ts`
- Workflow steps: `tenderEvaluationWorkflow.{pqEvaluate,technicalEvaluate,shortfallDetect,financialEvaluate,reportAssemble}.ts`
- API: `apps/api/src/routes/tender.ts` · Relay: `apps/relay/src/routes/tender.ts`
- UI: `apps/web/app/[tenant]/dashboard/tender-evaluation/{page.tsx,components/*}`
- Seed: `scripts/seed_tender_demo.ts`

Sample demo tender already seeded: **MP-DIT/HRMS/2024-25/001** — "Supply & Implementation of HRMS
for State Departments, MP", ₹8.5 Cr, 3 bidders: InfraVision (pq qualified), TechAxis (pq
disqualified), NovaSys (financial evaluated).

---

## 4. The critical problem — build is a SHELL (evidence)

In `tenderEvaluationWorkflow.technicalEvaluate.ts`:
1. **The verdict is scripted into the prompt.** The userPrompt literally contains:
   *"InfraVision Technologies has a strong HRMS track record but their Clause 5.1 biometric
   integration spec uses a proprietary protocol rather than HL7/FHIR... Their Clause 3.9 response
   time guarantee is <3s not <2s."* → the model rephrases a pre-written answer.
2. **No documents are read.** RFP clauses are a hardcoded `RFP_CLAUSES` array; no bidder PDFs, no OCR.
3. **Cloud model default:** `DEFAULT_MODEL = gemini-2.5-flash` — violates on-prem scope §8/§10.
4. **Canned fallback:** on failure returns hardcoded findings.
5. **"Relay error 401"** (seen in UI): internal-service-key mismatch between api and relay envs.

⇒ Ask it to "upload this RFP + these bids and run it" and there is nothing real underneath. DQ.

---

## 5. The design we want (EXPERIENCE — already specced, NOT built)

Full detail in `2026-06-06-tender-demo-design.md`. Came out of a step-by-step officer role-play
(Claude = demo presenter, user = non-technical procurement officer). **7 gaps** the current build
does NOT have:

1. **Tender worklist/home** with stage badges (don't open on a single tender).
2. **Overview + Document Room** before evaluation (plain-language tender digest; organized docs).
3. **Two-sided docs** — "Tender Documents (what we asked)" vs "Bid Submission (what they offered)".
4. **Confirm-the-criteria** step before each run (officer signs off the extracted yardstick).
5. **Chat = structured-findings DB + RAG tools** (NOT raw docs), runs after eval, demo-scoped to a
   fixed set of supported questions.
6. **Neutral decision support — NEVER recommends a bidder (ABSOLUTE RULE).**
7. **Section-wise authoring**: brief → generate → review/edit → revise; CVC-safety flags advisory
   after generation; Word/PDF export (no lock-in). Demo = glimpse (1 section live + export).

The current build shows **counts** ("4 criteria / 8 clauses") instead of readable content — reads
like a status panel, not an officer's desk. P2 fixes this by rendering REAL output through this
experience.

---

## 6. Conflicts to resolve (decide before/within P2)

1. **Award recommendation:** scope §6 requires "award recommendation generation" but user set
   "AI never recommends a bidder" as ABSOLUTE. **Reconciliation (proposed, needs final OK):** system
   generates the mechanical **L1-based recommendation** (just stating the rule's arithmetic output)
   requiring **Approver sign-off**; the **chat advisor stays neutral** on discretionary judgment
   calls (e.g. cheaper-but-non-compliant vs pricier-compliant). AI states the rule outcome; AI never
   substitutes judgment on overrides.
2. **Model:** must be **on-prem/govt-controlled (vLLM/GPU or Ollama)**, NEVER cloud Gemini/Vertex.
3. **Scoring/QCBS:** scope requires technical **scoring + weightage** (not just L1 pass/fail) and
   **L1/L2/L3** + price normalization — current design under-scoped this. Add in P2.
4. **RBAC roles:** Procurement Officer / Evaluator / Approver / System Admin (scope §7/§9). Current
   demo is single-officer.

---

## 7. THE PLAN — two phased prompts

**P1 = make the engine real on ONE stage (technical eval). P2 = scale to 6 stages + experience.**
Phased on purpose: do NOT build the experience over a fake engine.

### Inputs the VM does NOT have yet (user provides later)
- Real sample PDFs (`scratch/tender-samples/rfp.pdf`, `bidder-A.pdf`).
- The vLLM/GPU on-prem endpoint URL.
⇒ P1 builds everything **parameterized**; the VM self-tests with a throwaway PDF + any reachable
on-prem model; the user does the final real-document + vLLM proof later.

### P1 PROMPT (give to VM)

> **P1 — Build the real technical-evaluation engine (parameterized; real docs + vLLM plug in later)**
>
> Context: the tender demo is a shell. `apps/relay/src/mastra/workflows/tenderEvaluationWorkflow.technicalEvaluate.ts`
> scripts the verdict into the prompt, uses a hardcoded `RFP_CLAUSES` array, ingests no documents,
> defaults to cloud Gemini, and has a canned fallback. The relay route 401s on an internal-key
> mismatch. Rebuild ONE stage to be genuinely real and configurable. Do NOT build other stages/UI.
> The VM does NOT have the real PDFs or vLLM endpoint yet — build so they plug in later; do not
> hardcode docs or model URLs. Self-test with a throwaway PDF + a reachable on-prem model
> (e.g. local Ollama :11434). Final content proof is the user's step.
>
> Tasks:
> 1. **Fix 401** — make `INTERNAL_SERVICE_KEY` identical+non-empty in `apps/api/.env` and
>    `apps/relay/.env`; verify 200 not 401.
> 2. **Document source = config** — input folder (default `scratch/tender-samples/`, env-overridable)
>    for `rfp.pdf` + `bidder-*.pdf`. Empty folder ⇒ fail clearly; NEVER fabricate.
> 3. **Real ingestion (reuse)** — wire the existing AI-PARAS ingestion (`/internal/ingest`):
>    OCR → chunk → embed → store, tagged to tender + bidder. All model/OCR via inference-gateway on
>    an **on-prem backend (env-configured)**; never cloud Gemini/Vertex.
> 4. **Rip out scripting in technicalEvaluate** — delete hardcoded `RFP_CLAUSES` (read clauses from
>    ingested RFP / `tender_clauses`); delete the answer-baked userPrompt (model gets ONLY the real
>    clause + retrieved actual bidder text via RAG, never the verdict); delete the canned fallback
>    (on failure ⇒ explicit error / `cannot_evaluate`, never fake). Output per clause: status +
>    one-line narration + citation (doc + page) into the real bidder doc.
> 5. **Model endpoint = env-driven** — on-prem via gateway; no `gemini-2.5-flash` default.
>
> Acceptance (VM proves now, throwaway PDF + reachable on-prem model):
> (1) 401 fixed → 200. (2) No `RFP_CLAUSES`, no verdict-in-prompt, no canned fallback remain.
> (3) Pipeline runs end-to-end: folder PDF → ingest → extract → retrieve → model → parsed finding
> with citation; output DERIVES from PDF content (edit a line → output changes). (4) Empty folder /
> model-down ⇒ clean error, zero fabricated findings. (5) No cloud Gemini/Vertex in the technical
> path; backend env-configurable on-prem.
>
> User proves later (real PDFs + vLLM): drop real docs, point env at vLLM, re-run → verdicts +
> citations match the real doc; editing a fact in the doc changes the verdict.
>
> Out of scope: PQ/pre-bid/shortfall/financial, worklist, Overview/Document Room, chat, UI redesign.
>
> Report back: (a) files changed, (b) config knobs (folder env, model env, internal key) + how to
> set, (c) self-test before/after (throwaway-PDF edit → output change), (d) exact steps for the
> user's real proof later, (e) blockers.

### P2 (to be written AFTER P1 verifies)
Scale the real engine to all 6 stages (PQ, pre-bid, technical, shortfall, financial, report) +
criteria generation/scoring/weightage + L1/L2/L3, and build the **walkthrough experience** (§5)
rendering REAL output. Resolve §6 conflicts. Add RBAC roles + export. Detailed prompt written once
P1's killer test passes.

---

## 8. Open inputs needed from the user
- [ ] Real sample PDFs → `scratch/tender-samples/` (rfp.pdf + bidder-A.pdf min).
- [ ] vLLM/GPU on-prem endpoint URL (for the gateway).
- [ ] Final OK on the award-recommendation reconciliation (§6.1).
- [ ] The 5 MPSEDC historical tenders (for the later accuracy-vs-ground-truth evaluation).

---

## 9. Test access
Cognito **normal user** (not platform admin) created for testing in pool `ap-south-1_7ojsspkCU`
(serverless-saas/dev, region ap-south-1):
- Email: `officer@mpsedc.demo` · Password: `Mpsedc@Demo2026` · Status: CONFIRMED.
- First login → app creates DB user, no tenant → `/onboarding` → create workspace → dashboard.
- Platform admins (hardcoded): `suyash@fitnearn.com`, `ops@fitnearn.com`.

---

## 10. Decisions locked (from the role-play)
- One tender flows through all 6 stages (single narrative thread).
- Entry point = the evaluation seam, NOT "we are the portal" (officer pulls bids out of GeM/CPPP).
- First screen = evaluation cockpit (land in the pain); authoring shown as a real but glimpse stage.
- Liveness: most stages pre-processed, technical eval runs live.
- Human owns every verdict; AI never decides; source citation everywhere.
- AI NEVER recommends a bidder (absolute) — reconciled with mechanical L1 recommendation (§6.1).
- Domain defaults: GFR 2017, two-bid (Technical + Financial), L1 (extend to L1/L2/L3 + scoring).
