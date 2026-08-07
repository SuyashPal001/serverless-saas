# Document Generator (#3) — closing the auto-selection, mandatory-clause, annexure, and finalization gaps

## Context

OIL microservice #3, "Document Generator," is ~50% built (`OIL-SCOPE-GAP-PLAN.md` §1): `tender-authoring.ts` (relay) + `AuthoringPanel`/`ClauseLibraryPanel` (web) already draft an 8-section RFP (S1–S8) via `tenderAuthorAgent`, with a clause library the LLM can cite. What's missing, per the gap plan:

1. Rule-based clause auto-selection by material type/value (today the LLM freely decides which library clauses to cite — no deterministic gating).
2. EMD/PBG/Integrity Pact/MSE auto-application based on tender conditions.
3. GCC/GTC annexures and commercial annexures as standard documents.
4. Inter-module compatibility checks before finalizing.

This spec covers all four, each kept narrow — same spirit as the five Tier 1 items already built this week (`docs/superpowers/plans/2026-08-0{5,6}-tender-*.md`), which followed subagent-driven-development: a written plan, TDD where logic is pure/testable, task-scoped review, final branch review.

## Decisions locked during brainstorming

- **Rules compute + enforce, not advise-only.** A deterministic rules engine computes the mandatory clause set; the LLM prompt is told to include it, and a post-generation pass verifies/patches it in if omitted. Applicability is never left to LLM judgment alone — mirrors AI-PARAS's principle that the verdict stays deterministic and the LLM only narrates.
- **GCC/GTC are new annexure sections (S9+) in the existing `rfpSections` model**, not a separate document table. They go through the same accept/version/publish lifecycle as S1–S8.
- **Inter-module compatibility check = reuse Document Checker (#2, already built), gated on Publish.** No new conflict-detection logic — Document Generator's finalization step calls the existing `documentChecks` results instead of duplicating clause-conflict scanning.
- **Threshold values are standard GFR/CVC-style defaults**, not OIL-specific (OIL hasn't supplied their procurement manual) — same posture as `tender_pq_rules.json`'s generic PQ criteria.
- **Single shared rules module**, called from both `generateRfpBackground` (full generation) and `/internal/tender/section/regenerate` (single-section redraft), rather than two independent implementations — closes existing duplication between those two prompt-builders rather than adding to it.

## Architecture

### 1. Clause rules engine (new)

`apps/relay/src/mastra/rules/tenderClauseRules.ts` — pure function, same shape/pattern as `tenderPqRules.ts` (JSON-driven, no hardcoded thresholds in TS):

```ts
export interface MandatoryClause {
  clauseNo: string          // e.g. "8.10"
  libraryRef: string        // clauseLibrary.code, e.g. "CL-021"
  title: string
  reason: string            // human-readable: why this applies (for the prompt + for audit)
}
export interface AnnexureSpec {
  sectionNo: string          // "S9", "S10"
  title: string
  libraryRef: string         // clauseLibrary.code with category:'annexure'
}
export function computeApplicableClauses(
  tender: { budget: string | null },
  templateFields: Record<string, unknown>
): { mandatory: MandatoryClause[]; annexures: AnnexureSpec[] }
```

Rules data: `ai-service/rules/tender/tender_clause_rules.json`, GFR/CVC-style defaults:
- **EMD** — 2% of estimated value for goods/works; clause carries a note that MSE-registered bidders are exempt (the exemption itself is a fixed informational clause, not a threshold rule).
- **PBG** — 3–5% of contract value, mandatory whenever a contract is awarded (present at every value band, percentage scales with value tier).
- **Integrity Pact** — mandatory when estimated value ≥ ₹1 Cr.
- **MSE participation/exemption clause** — always included (informational, not conditional).
- **GCC/GTC annexure set** — selected by `templateFields.category` (goods / services / works each map to a distinct annexure set).

Clause library additions: annexure content is stored as ordinary `clauseLibrary` rows tagged `category: 'annexure'` — no new table. Seed data adds GCC-GOODS / GTC-SERVICES / GTC-WORKS / commercial-annexure entries.

### 2. Injection + enforcement

Both `generateRfpBackground` and the `/internal/tender/section/regenerate` route in `apps/relay/src/routes/tenderAuthoring.ts`:
- Call `computeApplicableClauses(tender, templateFields)`.
- Inject `mandatory` into the prompt as a "must include, with these exact figures" block — same pattern as the existing `turnoverThresholdCr`/`similarWorkThresholdCr` injection.
- After the agent returns and sections are parsed, run `enforceRequiredClauses(sections, mandatory)`: for each mandatory item, check S8's `content.clauses[]` for a matching `clauseNo` or `libraryRef`; if absent, append the clause verbatim from `clauseLibrary` (not re-drafted by the LLM) before `saveRfpSections` persists.

This function is pure (sections in, sections out) and independently unit-testable without hitting the LLM or DB.

### 3. GCC/GTC annexure sections

- Extend the section model to `blockType: 'annexure'`. Generation prompt (`buildUserPrompt` and the single-section format helper) gains S9 (GCC/GTC) and S10 (Commercial Annexures) to the output schema, populated from `AnnexureSpec[]` — content is the library text pasted in, not freshly drafted prose, since annexures are standard boilerplate.
- Web: `RFPSection`/`AuthoringPanel` need to render `blockType: 'annexure'` — reuse the existing `prose` rendering path if the content shape matches (`{text, clauses}`); confirm during implementation whether a distinct render case is actually needed or whether `prose` handles it as-is.
- Annexure sections go through the same accept/version/regenerate/publish lifecycle as S1–S8 — no special-casing in `AuthoringPanel`'s accepted-count/publish-eligibility logic.

### 4. Publish gate (inter-module compatibility)

`apps/api/src/routes/tenderAuthoring.ts`, `POST /authoring/:id/publish`:
- Before the existing "all sections accepted" check, query `documentChecks` for the tender. If any row has `status: 'fail'`, return 422 with the failing check summary instead of publishing.
- Add an explicit officer override path (`?override=true` from a checkbox in the publish confirm dialog) that bypasses the block; when used, `auditLog` gets `metadata.checksOverridden: true` alongside the existing `tender_publish` entry.
- No new conflict-detection logic — this wires two already-built features together.

## Data flow

```
tender fields (budget, templateFields.category)
        │
        ▼
computeApplicableClauses()  ──► { mandatory[], annexures[] }
        │                              │
        ▼                              ▼
prompt injection            S9/S10 annexure content
(generateRfpBackground /            (from clauseLibrary
 section/regenerate)                  category:'annexure')
        │
        ▼
LLM drafts sections (S1–S10)
        │
        ▼
enforceRequiredClauses()  ──► patches S8 if LLM omitted a mandatory clause
        │
        ▼
saveRfpSections()  (unchanged)
        │
        ▼
officer accepts all sections
        │
        ▼
POST /authoring/:id/publish
        │
        ├─► documentChecks has status:'fail'? ──► 422 (unless ?override=true, audited)
        │
        ▼
published
```

## Error handling

- `computeApplicableClauses` never throws on missing `templateFields.category` — falls back to a documented default category (goods), consistent with existing fallbacks (`templateFields.category ?? 'IT/Software'` already exists in `buildUserPrompt`).
- `enforceRequiredClauses` is defensive: if a mandatory clause's `libraryRef` doesn't resolve in the loaded `clauseLibrary` rows (bad seed data), log and skip rather than throw — a missing library row shouldn't fail the whole generation run.
- Publish-gate query failure (DB error reaching `documentChecks`) fails closed — publish is blocked, not silently allowed, consistent with the existing all-sections-accepted check's behavior.

## Testing

- `tenderClauseRules.test.ts` — unit tests per threshold band (below/at/above EMD, Integrity Pact, MSE boundaries) and per category → annexure-set mapping. Same style as existing `tenderPqRules` tests (if any exist — verify pattern) or `searchClauseLibraryQuery.test.ts`.
- `enforceRequiredClauses` — unit test with a deliberately-incomplete LLM output fixture (missing one mandatory clause) confirming it gets patched in verbatim from the library, and a complete-output fixture confirming no duplicate insertion.
- Publish gate — integration-style test: fail-status blocks with 422, override bypasses and records `checksOverridden: true` in audit log, all-pass proceeds unchanged.

## Out of scope (explicitly deferred)

- OIL-specific threshold values (using GFR/CVC generic defaults instead — swap when/if OIL supplies their manual).
- New conflict-detection logic beyond what Document Checker already does.
- A distinct annexure-rendering UI component (reuse `prose` rendering unless implementation proves it doesn't fit).
- Live verification — this feature is subject to the same Tier 0 VM-verification blocker as the five Tier 1 items ([[project_pending_tier0_vm]]); code-complete + unit-tested is the bar for this pass, not live-demoed.
