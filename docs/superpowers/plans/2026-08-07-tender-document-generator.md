# Tender Document Generator — Rules, Annexures, Workflow Conversion & Publish Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps on OIL RFP item #3 "Document Generator" (`OIL-SCOPE-GAP-PLAN.md` §1): deterministic clause auto-selection by category/value, EMD/PBG/Integrity Pact/MSE mandatory-clause enforcement, GCC/GTC + commercial annexures (S9/S10), and a Publish gate wired to the already-built Document Checker (#2). Converts RFP generation from an imperative route into a real Mastra workflow along the way, matching every other generation pipeline in this codebase.

**Architecture:** A pure, vitest-tested rules module (`tenderClauseRules.ts`, mirrors `tenderPqRules.ts`) computes mandatory clauses and annexure sets from tender value/category. `tenderAuthoring.ts`'s `generateRfpBackground` is decomposed into a 4-step Mastra workflow (`tenderAuthoringWorkflow`, mirrors `tenderEvaluationWorkflow.ts`): compute rules → draft (LLM) → enforce mandatory clauses → save. The single-section regenerate route stays a lightweight route but calls the same rules functions directly, so nothing is duplicated. `tender-authoring/SKILL.md` (the agent's actual instructions) gets EMD/IP/MSE/S9/S10 added. The Publish route gains a gate on `documentChecks` (Document Checker's existing output table), with an audited officer-override path.

**Tech Stack:** Drizzle ORM + Postgres, `@mastra/core` (`createWorkflow`/`createStep`), Hono routes, zod, vitest, Next.js/React — all already in use; no new dependencies.

## Global Constraints

- Work on branch `develop` in `serverless-saas/` — never `master`/`main`.
- Mastra file pattern: one tool per file, one agent per file; workflows use composition (one file per step) + a `.schemas.ts` file, not monolithic files.
- Every DB query must filter by `tenantId` (tenancy invariant enforced across the whole codebase).
- No placeholder code, no TODOs — every step below is complete, runnable code.
- Threshold values are standard GFR/CVC-style defaults, not OIL-specific (per spec — swap later if OIL supplies their manual).

---

## Task 1: Clause rules engine — JSON data + pure functions + tests

**Files:**
- Create: `apps/ai-service/rules/tender/tender_clause_rules.json`
- Create: `apps/relay/src/mastra/rules/tenderClauseRules.ts`
- Create: `apps/relay/src/mastra/rules/__tests__/tenderClauseRules.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no DB/LLM/agent dependency) — same shape as `tenderPqRules.ts`.
- Produces: `computeApplicableClauses(tender: {budget: string | null}, templateFields: Record<string, unknown>): {mandatory: MandatoryClause[]; annexures: AnnexureSpec[]}`, `enforceRequiredClauses(sections: RfpSectionLike[], mandatory: MandatoryClause[], libraryRows: LibraryRowLike[]): RfpSectionLike[]`, `normalizeCategory(raw: unknown): 'goods' | 'services' | 'works'`. `MandatoryClause = {clauseNo, libraryRef, title, reason}`, `AnnexureSpec = {sectionNo, title, libraryRef}`. Consumed by Task 4 (`computeClauseRulesStep`), Task 6 (`enforceMandatoryClausesStep`), and Task 7 (regenerate route).

- [ ] **Step 1: Write the rules data file**

```json
// apps/ai-service/rules/tender/tender_clause_rules.json
{
  "version": "1.0",
  "domain": "GFR 2017 / CVC — Mandatory Clause & Annexure Selection",
  "mandatoryClauses": [
    {
      "id": "MC-EMD",
      "clauseNo": "8.10",
      "libraryRef": "CL-021",
      "title": "Earnest Money Deposit (EMD)",
      "categories": ["goods", "works"],
      "minValueInr": 0,
      "reason": "EMD is mandatory for goods/works procurement per GFR Rule 170 (2% of estimated value); MSE-registered bidders are exempt per MSME Act Section 11B."
    },
    {
      "id": "MC-PBG",
      "clauseNo": "8.2",
      "libraryRef": "CL-015",
      "title": "Performance Bank Guarantee (PBG)",
      "categories": null,
      "minValueInr": 0,
      "reason": "PBG is mandatory on contract award per GFR Rule 171, regardless of category or value."
    },
    {
      "id": "MC-IP",
      "clauseNo": "8.11",
      "libraryRef": "CL-022",
      "title": "Integrity Pact",
      "categories": null,
      "minValueInr": 10000000,
      "reason": "CVC guidelines mandate an Integrity Pact for tenders valued at Rs. 1 Crore or above."
    },
    {
      "id": "MC-MSE",
      "clauseNo": "8.12",
      "libraryRef": "CL-023",
      "title": "MSE Participation & Exemption",
      "categories": null,
      "minValueInr": 0,
      "reason": "Public Procurement Policy for MSEs Order 2012 — always stated regardless of category or value."
    }
  ],
  "annexureSets": {
    "goods":    [{ "sectionNo": "S9", "title": "General Conditions of Contract (GCC) — Goods",    "libraryRef": "CL-024" }],
    "services": [{ "sectionNo": "S9", "title": "General Terms & Conditions (GTC) — Services", "libraryRef": "CL-025" }],
    "works":    [{ "sectionNo": "S9", "title": "General Terms & Conditions (GTC) — Works",    "libraryRef": "CL-026" }]
  },
  "commercialAnnexure": { "sectionNo": "S10", "title": "Commercial Annexures", "libraryRef": "CL-027" }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/relay/src/mastra/rules/__tests__/tenderClauseRules.test.ts
import { describe, it, expect } from 'vitest';
import { computeApplicableClauses, enforceRequiredClauses, normalizeCategory } from '../tenderClauseRules.js';

describe('normalizeCategory', () => {
  it('maps goods/supply/equipment text to goods', () => {
    expect(normalizeCategory('Goods Procurement')).toBe('goods');
    expect(normalizeCategory('Supply of Hardware')).toBe('goods');
  });
  it('maps works/construction/civil text to works', () => {
    expect(normalizeCategory('Civil Works')).toBe('works');
    expect(normalizeCategory('Construction')).toBe('works');
  });
  it('defaults to services for anything else, including undefined', () => {
    expect(normalizeCategory('IT/Software')).toBe('services');
    expect(normalizeCategory(undefined)).toBe('services');
  });
});

describe('computeApplicableClauses', () => {
  it('includes EMD for a goods tender below the Integrity Pact threshold', () => {
    const { mandatory } = computeApplicableClauses({ budget: '5000000' }, { category: 'Goods' }); // Rs. 50 lakh
    const ids = mandatory.map(m => m.libraryRef);
    expect(ids).toContain('CL-021'); // EMD
    expect(ids).toContain('CL-015'); // PBG always
    expect(ids).toContain('CL-023'); // MSE always
    expect(ids).not.toContain('CL-022'); // below Rs. 1 Cr — no Integrity Pact
  });

  it('excludes EMD for a services tender (EMD only applies to goods/works)', () => {
    const { mandatory } = computeApplicableClauses({ budget: '5000000' }, { category: 'IT/Software' });
    expect(mandatory.map(m => m.libraryRef)).not.toContain('CL-021');
  });

  it('includes Integrity Pact at exactly Rs. 1 Crore and above', () => {
    const atThreshold = computeApplicableClauses({ budget: '10000000' }, { category: 'Works' });
    expect(atThreshold.mandatory.map(m => m.libraryRef)).toContain('CL-022');

    const belowThreshold = computeApplicableClauses({ budget: '9999999' }, { category: 'Works' });
    expect(belowThreshold.mandatory.map(m => m.libraryRef)).not.toContain('CL-022');
  });

  it('treats a null/missing budget as zero value (no Integrity Pact, EMD/PBG/MSE still apply to works)', () => {
    const { mandatory } = computeApplicableClauses({ budget: null }, { category: 'Works' });
    const ids = mandatory.map(m => m.libraryRef);
    expect(ids).toContain('CL-021');
    expect(ids).not.toContain('CL-022');
  });

  it('selects the goods annexure set plus the commercial annexure for a goods tender', () => {
    const { annexures } = computeApplicableClauses({ budget: '5000000' }, { category: 'Goods' });
    expect(annexures).toEqual([
      { sectionNo: 'S9', title: 'General Conditions of Contract (GCC) — Goods', libraryRef: 'CL-024' },
      { sectionNo: 'S10', title: 'Commercial Annexures', libraryRef: 'CL-027' },
    ]);
  });

  it('selects the services annexure set for an unrecognized/default category', () => {
    const { annexures } = computeApplicableClauses({ budget: '5000000' }, {});
    expect(annexures[0].libraryRef).toBe('CL-025');
  });
});

describe('enforceRequiredClauses', () => {
  const mandatory = [
    { clauseNo: '8.10', libraryRef: 'CL-021', title: 'Earnest Money Deposit (EMD)', reason: 'x' },
    { clauseNo: '8.11', libraryRef: 'CL-022', title: 'Integrity Pact', reason: 'x' },
  ];
  const libraryRows = [
    { code: 'CL-021', title: 'Earnest Money Deposit (EMD)', content: 'EMD full clause text.' },
    { code: 'CL-022', title: 'Integrity Pact', content: 'Integrity Pact full clause text.' },
  ];

  function s8(clauses: Array<{ clauseNo: string; libraryRef?: string | null }>) {
    return [{ sectionNo: 'S8', title: 'Contract Terms', blockType: 'prose', content: { text: 'x', clauses } }];
  }

  it('patches in a mandatory clause the LLM omitted', () => {
    const result = enforceRequiredClauses(s8([]), mandatory, libraryRows);
    const clauses = (result[0].content as any).clauses;
    expect(clauses).toHaveLength(2);
    expect(clauses.find((c: any) => c.clauseNo === '8.10').text).toBe('EMD full clause text.');
    expect(clauses.find((c: any) => c.clauseNo === '8.10').source).toBe('library');
  });

  it('does not duplicate a clause already present by clauseNo', () => {
    const result = enforceRequiredClauses(
      s8([{ clauseNo: '8.10', libraryRef: 'CL-021' }]), mandatory, libraryRows
    );
    const clauses = (result[0].content as any).clauses;
    expect(clauses.filter((c: any) => c.clauseNo === '8.10')).toHaveLength(1);
    expect(clauses).toHaveLength(2); // 8.10 already there, 8.11 patched in
  });

  it('does not duplicate a clause already present by libraryRef under a different clauseNo', () => {
    const result = enforceRequiredClauses(
      s8([{ clauseNo: '8.5', libraryRef: 'CL-021' }]), mandatory, libraryRows
    );
    const clauses = (result[0].content as any).clauses;
    expect(clauses.filter((c: any) => c.libraryRef === 'CL-021')).toHaveLength(1);
  });

  it('skips (does not throw) when a mandatory libraryRef has no matching library row', () => {
    const result = enforceRequiredClauses(s8([]), mandatory, [libraryRows[0]]); // CL-022 missing
    const clauses = (result[0].content as any).clauses;
    expect(clauses).toHaveLength(1);
    expect(clauses[0].libraryRef).toBe('CL-021');
  });

  it('leaves non-S8 sections untouched', () => {
    const sections = [{ sectionNo: 'S3', title: 'Scope', blockType: 'prose', content: { text: 'x', clauses: [] } }];
    const result = enforceRequiredClauses(sections, mandatory, libraryRows);
    expect(result).toEqual(sections);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/relay && npx vitest run src/mastra/rules/__tests__/tenderClauseRules.test.ts`
Expected: FAIL — `Cannot find module '../tenderClauseRules.js'`.

- [ ] **Step 4: Write the implementation**

```typescript
// apps/relay/src/mastra/rules/tenderClauseRules.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export interface MandatoryClause {
  clauseNo: string
  libraryRef: string
  title: string
  reason: string
}

export interface AnnexureSpec {
  sectionNo: string
  title: string
  libraryRef: string
}

interface RawMandatoryRule {
  id: string; clauseNo: string; libraryRef: string; title: string
  categories: string[] | null; minValueInr: number; reason: string
}
interface RawAnnexureEntry { sectionNo: string; title: string; libraryRef: string }
interface RawRules {
  mandatoryClauses: RawMandatoryRule[]
  annexureSets: Record<string, RawAnnexureEntry[]>
  commercialAnnexure: RawAnnexureEntry
}

const RULES_PATH = process.env.TENDER_CLAUSE_RULES_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../ai-service/rules/tender/tender_clause_rules.json')

let cached: RawRules | null = null
function loadRules(): RawRules {
  if (!cached) cached = JSON.parse(readFileSync(RULES_PATH, 'utf8')) as RawRules
  return cached
}

export function normalizeCategory(rawCategory: unknown): 'goods' | 'services' | 'works' {
  const s = String(rawCategory ?? '').toLowerCase()
  if (s.includes('goods') || s.includes('supply') || s.includes('equipment')) return 'goods'
  if (s.includes('works') || s.includes('construction') || s.includes('civil')) return 'works'
  return 'services'
}

export function computeApplicableClauses(
  tender: { budget: string | null },
  templateFields: Record<string, unknown>
): { mandatory: MandatoryClause[]; annexures: AnnexureSpec[] } {
  const rules = loadRules()
  const category = normalizeCategory(templateFields.category)
  const estimatedValueInr = tender.budget ? Number(tender.budget) : 0

  const mandatory: MandatoryClause[] = rules.mandatoryClauses
    .filter(rule => {
      const categoryOk = rule.categories === null || rule.categories.includes(category)
      const valueOk = estimatedValueInr >= rule.minValueInr
      return categoryOk && valueOk
    })
    .map(rule => ({ clauseNo: rule.clauseNo, libraryRef: rule.libraryRef, title: rule.title, reason: rule.reason }))

  const annexures: AnnexureSpec[] = [
    ...(rules.annexureSets[category] ?? []),
    rules.commercialAnnexure,
  ].map(a => ({ sectionNo: a.sectionNo, title: a.title, libraryRef: a.libraryRef }))

  return { mandatory, annexures }
}

export interface RfpSectionLike {
  sectionNo: string
  title: string
  blockType: string
  content: Record<string, unknown>
}

export interface LibraryRowLike {
  code: string
  title: string
  content: string
}

export function enforceRequiredClauses(
  sections: RfpSectionLike[],
  mandatory: MandatoryClause[],
  libraryRows: LibraryRowLike[]
): RfpSectionLike[] {
  const libraryByCode = new Map(libraryRows.map(r => [r.code, r]))

  return sections.map(section => {
    if (section.sectionNo !== 'S8') return section

    const content = section.content as { text?: string; clauses?: Array<{ clauseNo: string; libraryRef?: string | null }> }
    const existingClauses = content.clauses ?? []
    const presentNos = new Set(existingClauses.map(c => c.clauseNo))
    const presentRefs = new Set(existingClauses.filter(c => c.libraryRef).map(c => c.libraryRef))

    const toAdd = mandatory.filter(m => !presentNos.has(m.clauseNo) && !presentRefs.has(m.libraryRef))
    if (toAdd.length === 0) return section

    const patchedClauses = [...existingClauses]
    for (const m of toAdd) {
      const libraryRow = libraryByCode.get(m.libraryRef)
      if (!libraryRow) {
        console.warn(`[tenderClauseRules] mandatory clause ${m.clauseNo} references unknown library code ${m.libraryRef} — skipped`)
        continue
      }
      patchedClauses.push({
        clauseNo: m.clauseNo, title: libraryRow.title, text: libraryRow.content,
        source: 'library', libraryRef: m.libraryRef,
      } as unknown as { clauseNo: string; libraryRef?: string | null })
    }

    return { ...section, content: { ...content, clauses: patchedClauses } }
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/relay && npx vitest run src/mastra/rules/__tests__/tenderClauseRules.test.ts`
Expected: PASS, 14/14 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/rules/tender/tender_clause_rules.json apps/relay/src/mastra/rules/tenderClauseRules.ts apps/relay/src/mastra/rules/__tests__/tenderClauseRules.test.ts
git commit -m "feat(tender): clause auto-selection + mandatory-clause enforcement rules engine"
```

---

## Task 2: Clause library seed additions

**Files:**
- Modify: `apps/api/src/routes/tenderClauseSeed.ts` (append to `SEED_CLAUSES` array)

**Interfaces:**
- Consumes: nothing new.
- Produces: 7 new `clauseLibrary` seed rows (`CL-021`–`CL-027`) — consumed by `ensureClauseLibrary` (existing, unmodified) for newly-seeded tenants, and referenced by `libraryRef` in Task 1's rules JSON.

- [ ] **Step 1: Append the new clauses**

Add these entries to the end of the `SEED_CLAUSES` array in `apps/api/src/routes/tenderClauseSeed.ts` (immediately after the `CL-020` entry, before the closing `];`):

```typescript
  { code: 'CL-021', category: 'Eligibility/PQ', title: 'Earnest Money Deposit (EMD)', content: 'The bidder shall furnish an Earnest Money Deposit (EMD) of 2% of the estimated contract value in the form of a Bank Guarantee or Demand Draft from a scheduled commercial bank, valid for the bid validity period plus 45 days. Bidders registered as Micro or Small Enterprises (MSE) under the MSME Act are exempt from EMD on production of a valid Udyam Registration Certificate.', tags: ['emd', 'eligibility'] },
  { code: 'CL-022', category: 'Commercial', title: 'Integrity Pact', content: 'For tenders valued at Rs. 1 Crore or above, the bidder and the procuring entity shall execute an Integrity Pact in the prescribed format binding both parties to a corruption-free, transparent procurement process, monitored by an Independent External Monitor as per CVC guidelines.', tags: ['integrity-pact', 'cvc', 'commercial'] },
  { code: 'CL-023', category: 'Eligibility/PQ', title: 'MSE Participation & Exemption', content: 'Micro and Small Enterprises (MSEs) registered under the MSME Act are eligible for exemption from EMD, exemption from tender-fee, and relaxation of prior-turnover/experience criteria up to 25% of requirement, in accordance with the Public Procurement Policy for MSEs Order 2012 and subsequent amendments. MSEs shall submit a valid Udyam Registration Certificate to claim these benefits.', tags: ['mse', 'msme', 'eligibility'] },
  { code: 'CL-024', category: 'annexure', title: 'General Conditions of Contract (GCC) — Goods', content: 'Standard General Conditions of Contract applicable to procurement of goods under GFR 2017: definitions, delivery and inspection, warranty, packing and marking, insurance, transportation, spare parts, force majeure, and settlement of disputes. Special Conditions of Contract (SCC), where present, take precedence over these GCC to the extent of any conflict.', tags: ['gcc', 'goods', 'annexure'] },
  { code: 'CL-025', category: 'annexure', title: 'General Terms & Conditions (GTC) — Services', content: 'Standard General Terms & Conditions applicable to procurement of services under GFR 2017: scope of services, personnel deployment, performance standards, confidentiality, intellectual property, indemnity, and termination. Special Conditions of Contract (SCC), where present, take precedence over these GTC to the extent of any conflict.', tags: ['gtc', 'services', 'annexure'] },
  { code: 'CL-026', category: 'annexure', title: 'General Terms & Conditions (GTC) — Works', content: 'Standard General Terms & Conditions applicable to works contracts under GFR 2017: site possession, defect liability period, retention money, variation orders, and completion certification. Special Conditions of Contract (SCC), where present, take precedence over these GTC to the extent of any conflict.', tags: ['gtc', 'works', 'annexure'] },
  { code: 'CL-027', category: 'annexure', title: 'Commercial Annexures — Standard Formats', content: 'Standard commercial annexures: Format of Bank Guarantee (EMD/PBG), Format of Integrity Pact, Format of Bid Form, Format of Price Schedule (BOQ), and Format of Compliance Statement — attached to the RFP for bidder use.', tags: ['commercial', 'formats', 'annexure'] },
```

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/tenderClauseSeed.ts
git commit -m "feat(tender): seed EMD/Integrity Pact/MSE/GCC-GTC/commercial-annexure clauses"
```

**Note for later verification (do not treat as a bug to fix in this plan):** `ensureClauseLibrary` only seeds a tenant's library if it is currently empty (`if (existing) return`). A tenant seeded before this change will not automatically receive `CL-021`–`CL-027`. This is an existing limitation of the seeding pattern, not new — out of scope per the spec's "Out of scope" section. Flag it during Tier-0 VM verification: the demo tenant may need its clause library re-seeded manually (delete existing `clauseLibrary` rows for that tenant, or insert the 7 new rows directly) to exercise this feature.

---

## Task 3: Workflow schemas

**Files:**
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.schemas.ts`

**Interfaces:**
- Consumes: `MandatoryClause`, `AnnexureSpec` shapes from Task 1 (mirrored as zod schemas, not imported — this codebase's other `.schemas.ts` files define zod shapes standalone rather than deriving from TS interfaces, matching `tenderEvaluationWorkflow.schemas.ts`).
- Produces: `authoringInputSchema`, `clauseRulesStepOutputSchema`, `draftStepOutputSchema`, `enforceStepOutputSchema`, `saveStepOutputSchema` — consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Write the schemas**

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.schemas.ts
import { z } from 'zod'

export const authoringInputSchema = z.object({
  tenderId: z.string(),
  tenantId: z.string(),
})

export const mandatoryClauseSchema = z.object({
  clauseNo: z.string(),
  libraryRef: z.string(),
  title: z.string(),
  reason: z.string(),
})

export const annexureSpecSchema = z.object({
  sectionNo: z.string(),
  title: z.string(),
  libraryRef: z.string(),
})

export const clauseRulesStepOutputSchema = authoringInputSchema.extend({
  mandatory: z.array(mandatoryClauseSchema),
  annexures: z.array(annexureSpecSchema),
})

export const rfpSectionSchema = z.object({
  sectionNo: z.string(),
  title: z.string(),
  blockType: z.string(),
  content: z.record(z.any()),
})

export const draftStepOutputSchema = clauseRulesStepOutputSchema.extend({
  sections: z.array(rfpSectionSchema),
  cvcFlags: z.array(z.record(z.any())),
})

export const enforceStepOutputSchema = draftStepOutputSchema

export const saveStepOutputSchema = authoringInputSchema.extend({
  sectionCount: z.number(),
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.schemas.ts
git commit -m "feat(tender): tenderAuthoringWorkflow zod schemas"
```

(No test file — this is a pure zod schema definition file with no branching logic, same as `tenderEvaluationWorkflow.schemas.ts`, which also has no test file.)

---

## Task 4: `computeClauseRulesStep`

**Files:**
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.computeClauseRules.ts`

**Interfaces:**
- Consumes: `computeApplicableClauses` (Task 1), `authoringInputSchema`/`clauseRulesStepOutputSchema` (Task 3), `tenders` table from `@serverless-saas/database`.
- Produces: `computeClauseRulesStep` (Mastra `Step`) — consumed by Task 6's workflow composition.

- [ ] **Step 1: Write the step**

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.computeClauseRules.ts
import { createStep } from '@mastra/core/workflows'
import { db, tenders } from '@serverless-saas/database'
import { eq } from 'drizzle-orm'
import { computeApplicableClauses } from '../rules/tenderClauseRules.js'
import { authoringInputSchema, clauseRulesStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

export const computeClauseRulesStep = createStep({
  id: 'tender-authoring-compute-clause-rules',
  inputSchema: authoringInputSchema,
  outputSchema: clauseRulesStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId } = inputData

    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    if (!tender) throw new Error(`tender not found: ${tenderId}`)

    const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
    const { mandatory, annexures } = computeApplicableClauses({ budget: tender.budget }, templateFields)

    return { tenderId, tenantId, mandatory, annexures }
  },
})
```

- [ ] **Step 2: Type-check**

Run: `cd apps/relay && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.computeClauseRules.ts
git commit -m "feat(tender): computeClauseRulesStep"
```

(No test file — thin DB-fetch-then-delegate step; the logic it delegates to is fully tested in Task 1. Same convention as `pqEvaluateStep` etc., which also have no dedicated step-level test.)

---

## Task 5: Shared JSON-extraction helper + `draftSectionsStep`

**Files:**
- Create: `apps/relay/src/tender/tenderAuthoringJson.ts`
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.draftSections.ts`

**Interfaces:**
- Consumes: `tenderAuthorAgent` (existing, `apps/relay/src/mastra/agents/tenderAuthorAgent.ts`), `clauseRulesStepOutputSchema`/`draftStepOutputSchema` (Task 3), `tenders`/`clauseLibrary` tables.
- Produces: `extractJsonObject(text: string): string` (shared helper — also consumed by Task 7's regenerate route, replacing its private copy), `draftSectionsStep` (Mastra `Step`) — consumed by Task 6's workflow composition.

- [ ] **Step 1: Extract the shared JSON-parsing helper**

This is moved verbatim from `apps/relay/src/routes/tenderAuthoring.ts`'s existing `extractJsonObject` function (currently private to that file) so both the new step and the regenerate route (Task 7) share one implementation instead of two.

```typescript
// apps/relay/src/tender/tenderAuthoringJson.ts

/**
 * Extract the first complete {...} JSON object from model output.
 * Strips markdown fences, then uses brace-depth tracking so trailing
 * commentary (which may contain { or }) doesn't corrupt the slice.
 */
export function extractJsonObject(text: string): string {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  const start = stripped.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in agent output')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1) }
  }
  throw new Error('Unmatched braces in agent JSON output')
}
```

- [ ] **Step 2: Write `draftSectionsStep`**

This moves `generateRfpBackground`'s LLM-call and prompt-building logic from `tenderAuthoring.ts` into a step, extended with S9/S10 output and the mandatory-clause "must include" block.

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.draftSections.ts
import { createStep } from '@mastra/core/workflows'
import { db, tenders, clauseLibrary } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { tenderAuthorAgent } from '../agents/tenderAuthorAgent.js'
import { extractJsonObject } from '../../tender/tenderAuthoringJson.js'
import type { MandatoryClause, AnnexureSpec } from '../rules/tenderClauseRules.js'
import { clauseRulesStepOutputSchema, draftStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

interface PromptArgs {
  tender: { title: string; department: string; budget: string | null }
  templateFields: Record<string, unknown>
  requirementText: string
  libraryText: string
  mandatory: MandatoryClause[]
  annexures: AnnexureSpec[]
}

export function buildAuthoringPrompt({ tender, templateFields, requirementText, libraryText, mandatory, annexures }: PromptArgs): string {
  const jurisdiction = String(templateFields.jurisdiction ?? 'Government of Madhya Pradesh')

  const estimatedValue = tender.budget ? Number(tender.budget) : 0
  const durationMonths = parseInt(String(templateFields.contractDuration ?? '36'), 10) || 36
  const annualValue = estimatedValue > 0 ? estimatedValue / (durationMonths / 12) : 0
  const turnoverThresholdCr = annualValue > 0
    ? `Rs. ${(annualValue / 1e7).toFixed(2)} Crore (= Estimated Value ÷ ${(durationMonths / 12).toFixed(1)} years; MUST use this figure — do not substitute a fixed library amount)`
    : '(derive from estimated value)'
  const similarWorkThresholdCr = estimatedValue > 0
    ? `Rs. ${(estimatedValue * 0.5 / 1e7).toFixed(2)} Crore (= 50% of Estimated Value per CL-002; MUST use this exact figure, written with the numeric crore value first in the threshold cell — do not substitute a library or arbitrary amount)`
    : '(derive from estimated value)'

  const mandatoryBlock = mandatory.length
    ? mandatory.map(m => `- Clause ${m.clauseNo} "${m.title}" (cite libraryRef "${m.libraryRef}"): ${m.reason}`).join('\n')
    : '(none apply to this tender)'

  const annexureBlock = annexures.map(a =>
    `${a.sectionNo} "${a.title}" — paste the full text of library clause "${a.libraryRef}" verbatim as this section's content.text; this is boilerplate, not freshly drafted prose.`
  ).join('\n')

  return `Draft a complete government RFP with the following details.

Title: ${tender.title}
Department: ${tender.department}
Issuing Authority: ${jurisdiction}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}
Derived Annual Turnover Threshold for S2: ${turnoverThresholdCr}
Derived Similar-Work Experience Threshold for S2: ${similarWorkThresholdCr}
Key Dates: ${JSON.stringify(templateFields.keyDates ?? {})}

S3 SCOPE INSTRUCTION: In S3 (Scope of Work), enumerate ALL key functional modules listed in the requirement document (including any Annexure listing sub-modules such as Pension/GPF/NPS, payroll, HR modules, etc.) as distinct bullet-style clauses. Each module should be a named clause in the clauses[] array, not buried in the text field.

MANDATORY S8 CLAUSES — these MUST appear in S8's clauses[] array with the exact clauseNo shown, source:"library", and the given libraryRef (do not omit any of these; the system will patch them in if you do, but include them yourself):
${mandatoryBlock}

MANDATORY ANNEXURE SECTIONS — draft these in addition to S1–S8, using blockType "annexure":
${annexureBlock || '(none)'}

Requirement Document:
${requirementText.slice(0, 200000) || '(Draft from title and department context.)'}

Clause library (set source:"library" + libraryRef to the clause code when reusing):
${libraryText || '(None)'}

OUTPUT FORMAT — return ONLY this JSON, no markdown. S7 clauses[] must have ≥5 entries (7.1–7.5). S8 clauses[] must have ≥9 entries (8.1–8.9, plus the mandatory clauses above). Include cvcFlags array ([] if none). Include one annexure-type section per MANDATORY ANNEXURE SECTION listed above.
{"sections":[{"sectionNo":"S1","title":"Notice Inviting Tender & Overview","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"1.1","title":"...","text":"...","source":"drafted","libraryRef":null}]}},{"sectionNo":"S2","title":"Eligibility / Pre-Qualification Criteria","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S3","title":"Scope of Work","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S4","title":"Technical Specifications","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S5","title":"Service Levels (SLA / KPI)","blockType":"spec-table","content":{"rows":[{"metric":"...","target":"...","measurement":"..."}],"clauses":[]}},{"sectionNo":"S6","title":"Bill of Quantities","blockType":"line-item-table","content":{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}},{"sectionNo":"S7","title":"Evaluation Methodology","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"7.1","title":"Bid Opening Sequence","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.2","title":"Technical Qualification","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.3","title":"Financial Evaluation","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.4","title":"Award","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.5","title":"QCBS (if applicable)","text":"...","source":"drafted","libraryRef":null}]}},{"sectionNo":"S8","title":"Contract Terms, Compliance & Security","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"8.1","title":"Payment Terms","text":"...","source":"library","libraryRef":"CL-013"},{"clauseNo":"8.2","title":"Performance Bank Guarantee","text":"...","source":"library","libraryRef":"CL-015"},{"clauseNo":"8.3","title":"Liquidated Damages","text":"...","source":"library","libraryRef":"CL-014"},{"clauseNo":"8.4","title":"Warranty / AMC","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.5","title":"Security & Compliance","text":"...","source":"library","libraryRef":"CL-016"},{"clauseNo":"8.6","title":"Confidentiality","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.7","title":"Intellectual Property","text":"...","source":"library","libraryRef":"CL-020"},{"clauseNo":"8.8","title":"Termination","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.9","title":"Governing Law & Dispute Resolution","text":"...","source":"library","libraryRef":"CL-019"},{"clauseNo":"8.10","title":"Earnest Money Deposit (EMD)","text":"...","source":"library","libraryRef":"CL-021"}]}},{"sectionNo":"S9","title":"General Conditions / Terms of Contract","blockType":"annexure","content":{"text":"...","clauses":[]}},{"sectionNo":"S10","title":"Commercial Annexures","blockType":"annexure","content":{"text":"...","clauses":[]}}],"cvcFlags":[{"section":"S2","clauseRef":"2.1","concern":"...","suggestion":"..."}]}`
}

export const draftSectionsStep = createStep({
  id: 'tender-authoring-draft-sections',
  inputSchema: clauseRulesStepOutputSchema,
  outputSchema: draftStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, mandatory, annexures } = inputData

    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    if (!tender) throw new Error(`tender not found: ${tenderId}`)

    const libraryRows = await db.select().from(clauseLibrary)
      .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))
    const libraryText = libraryRows.map(cl => `${cl.code} [${cl.category}] "${cl.title}": ${cl.content}`).join('\n')
    const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
    const requirementText = tender.requirementText ?? ''

    const agentResult = await tenderAuthorAgent.generate(
      buildAuthoringPrompt({ tender, templateFields, requirementText, libraryText, mandatory, annexures })
    )
    const agentText = (agentResult.text ?? '').trim()
    const rawParsed = JSON.parse(extractJsonObject(agentText))
    const sections: unknown[] = Array.isArray(rawParsed)
      ? rawParsed
      : Array.isArray(rawParsed?.sections)
        ? rawParsed.sections
        : Array.isArray(rawParsed?.rfp?.sections)
          ? rawParsed.rfp.sections
          : []
    if (!sections.length) throw new Error(`Model returned 0 sections. Preview: ${agentText.slice(0, 200)}`)

    const cvcFlags: unknown[] = Array.isArray(rawParsed?.cvcFlags) ? rawParsed.cvcFlags : []

    return { tenderId, tenantId, mandatory, annexures, sections, cvcFlags }
  },
})
```

- [ ] **Step 3: Type-check**

Run: `cd apps/relay && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/relay/src/tender/tenderAuthoringJson.ts apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.draftSections.ts
git commit -m "feat(tender): draftSectionsStep — LLM drafting with mandatory-clause + annexure injection"
```

(No unit test — this step's only non-trivial logic is prompt-string construction and delegation to the LLM agent, same as `generateRfpBackground` before it, which also had no test. The deterministic parts it depends on — rule computation, enforcement — are fully tested in Task 1.)

---

## Task 6: `enforceMandatoryClausesStep`, `saveSectionsStep`, workflow composition, registration

**Files:**
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.enforceMandatoryClauses.ts`
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.saveSections.ts`
- Create: `apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.ts`
- Modify: `apps/relay/src/mastra/index.ts` (add import + register under `workflows:`)

**Interfaces:**
- Consumes: `enforceRequiredClauses` (Task 1), `draftStepOutputSchema`/`enforceStepOutputSchema`/`saveStepOutputSchema` (Task 3), `rfpSections`/`tenders`/`tenderClauses`/`clauseLibrary` tables.
- Produces: `enforceMandatoryClausesStep`, `saveSectionsStep`, `tenderAuthoringWorkflow` (registered as `'tender-authoring'` in `mastra/index.ts`) — consumed by Task 7's relay route.

- [ ] **Step 1: Write `enforceMandatoryClausesStep`**

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.enforceMandatoryClauses.ts
import { createStep } from '@mastra/core/workflows'
import { db, clauseLibrary } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { enforceRequiredClauses } from '../rules/tenderClauseRules.js'
import { draftStepOutputSchema, enforceStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

export const enforceMandatoryClausesStep = createStep({
  id: 'tender-authoring-enforce-mandatory-clauses',
  inputSchema: draftStepOutputSchema,
  outputSchema: enforceStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, mandatory, annexures, sections, cvcFlags } = inputData

    const libraryRows = await db.select().from(clauseLibrary)
      .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))

    const patchedSections = enforceRequiredClauses(
      sections as Array<{ sectionNo: string; title: string; blockType: string; content: Record<string, unknown> }>,
      mandatory,
      libraryRows
    )

    return { tenderId, tenantId, mandatory, annexures, sections: patchedSections, cvcFlags }
  },
})
```

- [ ] **Step 2: Write `saveSectionsStep`**

This moves `saveRfpSections` from `tenderAuthoring.ts` verbatim, plus the `authoringStatus`/`cvcFlags` update that previously happened at the end of `generateRfpBackground`.

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.saveSections.ts
import { createStep } from '@mastra/core/workflows'
import { db, tenders, tenderClauses, rfpSections } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { enforceStepOutputSchema, saveStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

interface SectionInput { sectionNo: string; title: string; blockType: string; content: object }

async function saveRfpSections(tenderId: string, tenantId: string, sections: SectionInput[]): Promise<void> {
  await db.delete(rfpSections).where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId)))

  for (const sec of sections) {
    await db.insert(rfpSections).values({
      tenderId, tenantId,
      sectionNo: sec.sectionNo, title: sec.title,
      blockType: sec.blockType, content: sec.content,
      version: 1,
    })
  }

  const s2 = sections.find((s): s is SectionInput & { content: { rows?: unknown[] } } => s.sectionNo === 'S2')
  const s4 = sections.find((s): s is SectionInput & { content: { rows?: Array<{ criterion: string; threshold: string; verification: string }> } } => s.sectionNo === 'S4')

  if (s2?.content?.rows) {
    await db.update(tenders).set({ pqCriteria: { criteria: s2.content.rows } }).where(eq(tenders.id, tenderId))
  }

  if (s4?.content?.rows) {
    await db.delete(tenderClauses).where(
      and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId), eq(tenderClauses.source, 'authored'))
    )
    const rows = s4.content.rows.map((r, i) => ({
      tenderId, tenantId,
      clauseNo: `4.${i + 1}`,
      title: r.criterion,
      content: `Threshold: ${r.threshold}; Verification: ${r.verification}`,
      category: 'technical',
      source: 'authored' as const,
    }))
    if (rows.length) await db.insert(tenderClauses).values(rows)
  }
}

export const saveSectionsStep = createStep({
  id: 'tender-authoring-save-sections',
  inputSchema: enforceStepOutputSchema,
  outputSchema: saveStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, sections, cvcFlags } = inputData

    await saveRfpSections(tenderId, tenantId, sections as SectionInput[])

    const [tender] = await db.select({ templateFields: tenders.templateFields }).from(tenders).where(eq(tenders.id, tenderId))
    const currentTf = (tender?.templateFields ?? {}) as Record<string, unknown>
    await db.update(tenders)
      .set({ authoringStatus: 'completed', templateFields: { ...currentTf, cvcFlags } })
      .where(eq(tenders.id, tenderId))

    return { tenderId, tenantId, sectionCount: sections.length }
  },
})
```

- [ ] **Step 3: Compose the workflow**

```typescript
// apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.ts
import { createWorkflow } from '@mastra/core/workflows'
import { authoringInputSchema, saveStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'
import { computeClauseRulesStep } from './tenderAuthoringWorkflow.computeClauseRules.js'
import { draftSectionsStep } from './tenderAuthoringWorkflow.draftSections.js'
import { enforceMandatoryClausesStep } from './tenderAuthoringWorkflow.enforceMandatoryClauses.js'
import { saveSectionsStep } from './tenderAuthoringWorkflow.saveSections.js'

export const tenderAuthoringWorkflow = createWorkflow({
  id: 'tender-authoring',
  inputSchema: authoringInputSchema,
  outputSchema: saveStepOutputSchema,
})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(computeClauseRulesStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(draftSectionsStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(enforceMandatoryClausesStep as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(saveSectionsStep as any)
  .commit()
```

- [ ] **Step 4: Register in `mastra/index.ts`**

Add the import next to the other workflow imports (after the `tenderEvaluationWorkflow` import):
```typescript
import { tenderAuthoringWorkflow } from './workflows/tenderAuthoringWorkflow.js'
```
Add the registration next to `'tender-evaluation'` inside the `workflows:` block:
```typescript
    'tender-authoring': tenderAuthoringWorkflow,
```

- [ ] **Step 5: Type-check**

Run: `cd apps/relay && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.enforceMandatoryClauses.ts apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.saveSections.ts apps/relay/src/mastra/workflows/tenderAuthoringWorkflow.ts apps/relay/src/mastra/index.ts
git commit -m "feat(tender): compose and register tenderAuthoringWorkflow"
```

---

## Task 7: Relay route conversion (trigger + regenerate)

**Files:**
- Modify: `apps/relay/src/routes/tenderAuthoring.ts` (replace `generateRfpBackground` + its helpers with a workflow trigger; update `/section/regenerate` to use the shared rules + JSON helper)

**Interfaces:**
- Consumes: `mastra` from `../mastra/index.js` (same import `tender.ts`/`pension.ts` already use), `computeApplicableClauses`/`enforceRequiredClauses` (Task 1), `extractJsonObject` (Task 5), `buildAuthoringPrompt` (Task 5, exported for reuse by the regenerate route's single-section prompt where useful — regenerate keeps its own prompt shape since it drafts one section, but calls the same rules functions).
- Produces: `POST /internal/tender/author` triggers `tenderAuthoringWorkflow` instead of calling the agent directly; `POST /internal/tender/section/regenerate` now injects mandatory-clause guidance and runs enforcement when regenerating S8.

- [ ] **Step 1: Replace the `/internal/tender/author` handler and remove the old generation helpers**

In `apps/relay/src/routes/tenderAuthoring.ts`, replace the whole `POST /internal/tender/author` handler plus the `generateRfpBackground`, `buildUserPrompt`, `saveRfpSections`, and `extractJsonObject` functions (everything from the route handler at the top through `saveRfpSections` — the `singleSectionOutputFormat` helper stays, used by regenerate) with:

```typescript
import { Hono } from 'hono'
import { db, tenders, tenderClauses, clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { mastra } from '../mastra/index.js'
import { tenderAuthorAgent } from '../mastra/agents/tenderAuthorAgent.js'
import { extractJsonObject } from '../tender/tenderAuthoringJson.js'
import { computeApplicableClauses, enforceRequiredClauses } from '../mastra/rules/tenderClauseRules.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderAuthoringRoutes = new Hono()

// POST /internal/tender/author — generate full RFP for a tender via tenderAuthoringWorkflow
tenderAuthoringRoutes.post('/internal/tender/author', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId } = body
  if (!tenderId || !tenantId) return c.json({ error: 'tenderId and tenantId required' }, 400)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  // Return 202 immediately — relay stays alive via PM2, workflow runs in background
  runAuthoringWorkflow(tenderId, tenantId)
  return c.json({ status: 'generating', tenderId }, 202)
})

async function runAuthoringWorkflow(tenderId: string, tenantId: string): Promise<void> {
  try {
    console.log(`[tender/author] starting tenderAuthoringWorkflow tenderId=${tenderId}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = await (mastra.getWorkflow('tender-authoring') as any).createRun()
    const result = await run.start({ inputData: { tenderId, tenantId } })
    console.log(`[tender/author] workflow completed tenderId=${tenderId}`, result?.result ?? result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/author] workflow failed', message)
    await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tenderId))
  }
}
```

- [ ] **Step 2: Update `/internal/tender/section/regenerate` to inject + enforce mandatory clauses**

Keep the existing `POST /internal/tender/section/regenerate` route, but change its body as follows — insert the rules computation right after loading `tender`, add the mandatory-clause block to the prompt, and run `enforceRequiredClauses` on the single returned section before saving when it's S8:

```typescript
// POST /internal/tender/section/regenerate — redraft one section with optional steer
tenderAuthoringRoutes.post('/internal/tender/section/regenerate', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)

  let body: { tenderId?: string; tenantId?: string; sectionId?: string; steer?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId, sectionId, steer } = body
  if (!tenderId || !tenantId || !sectionId) return c.json({ error: 'tenderId, tenantId, sectionId required' }, 400)

  const [section] = await db.select().from(rfpSections).where(eq(rfpSections.id, sectionId))
  if (!section) return c.json({ error: 'section not found' }, 404)

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
  if (!tender) return c.json({ error: 'tender not found' }, 404)

  const libraryRows = await db.select().from(clauseLibrary)
    .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))
  const libraryText = libraryRows.map(cl => `${cl.code} [${cl.category}] "${cl.title}": ${cl.content}`).join('\n')
  const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
  const requirementText = tender.requirementText ?? ''
  const { mandatory } = computeApplicableClauses({ budget: tender.budget }, templateFields)

  const sectionFormat = singleSectionOutputFormat(section.sectionNo, section.blockType)
  const mandatoryBlock = section.sectionNo === 'S8' && mandatory.length
    ? `\nMANDATORY CLAUSES — this section MUST include these, source:"library", with the exact clauseNo shown:\n${mandatory.map(m => `- Clause ${m.clauseNo} "${m.title}" (libraryRef "${m.libraryRef}"): ${m.reason}`).join('\n')}\n`
    : ''
  const prompt = `Redraft ONLY section ${section.sectionNo} of this RFP. Return a single JSON section object.

Title: ${tender.title}
Department: ${tender.department}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}
${mandatoryBlock}
Requirement Document:
${requirementText.slice(0, 200000) || '(Draft from title and department context.)'}

Clause library (set source:"library" + libraryRef to the clause code when reusing):
${libraryText || '(None)'}
${steer ? `\nOfficer steer: ${steer}` : ''}

OUTPUT FORMAT — return ONLY this JSON object, no markdown, no array:
${sectionFormat}`

  try {
    const agentResult = await tenderAuthorAgent.generate(prompt)
    const agentText = (agentResult.text ?? '').trim()
    const parsed = JSON.parse(extractJsonObject(agentText))
    if (!parsed.content) throw new Error('Regenerated section missing content field')

    let finalContent = parsed.content
    if (section.sectionNo === 'S8') {
      const [patched] = enforceRequiredClauses(
        [{ sectionNo: 'S8', title: section.title, blockType: section.blockType, content: parsed.content }],
        mandatory,
        libraryRows
      )
      finalContent = patched.content
    }

    const newVersion = section.version + 1
    await db.insert(rfpSectionVersions).values({
      sectionId, tenderId, tenantId, version: section.version,
      content: section.content as object, changeNote: `regenerate: ${steer ?? 'no steer'}`,
    })
    await db.update(rfpSections)
      .set({ content: finalContent, version: newVersion, updatedAt: new Date() })
      .where(eq(rfpSections.id, sectionId))
    return c.json({ status: 'completed', sectionId, version: newVersion, content: finalContent })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})
```

- [ ] **Step 3: Add an `annexure` case to `singleSectionOutputFormat`**

The existing `singleSectionOutputFormat` helper (kept as-is otherwise) needs one new branch so regenerating S9/S10 produces a valid format string. Add this check before the final `return base + '{}}'` fallback:

```typescript
  if (blockType === 'annexure')
    return base + `{"text":"...","clauses":[]}}`
```

- [ ] **Step 4: Type-check**

Run: `cd apps/relay && npx tsc --noEmit`
Expected: no new errors. In particular, confirm no other file still imports the now-removed `generateRfpBackground`, `buildUserPrompt`, or the old private `saveRfpSections`/`extractJsonObject` from `tenderAuthoring.ts` (`grep -rn "generateRfpBackground\|from '.*tenderAuthoring.js'" apps/relay/src apps/api/src` should show no remaining references beyond route registration).

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/routes/tenderAuthoring.ts
git commit -m "feat(tender): trigger tenderAuthoringWorkflow from /internal/tender/author; enforce mandatory clauses on S8 regenerate"
```

---

## Task 8: Skill update — `tender-authoring/SKILL.md`

**Files:**
- Modify: `apps/relay/skills/tender-authoring/SKILL.md`

**Interfaces:**
- Consumes: nothing (static content file, loaded as `tenderAuthorAgent`'s instructions).
- Produces: updated agent instructions reflected in every subsequent `tenderAuthorAgent.generate()` call (Task 5's `draftSectionsStep`, Task 7's regenerate route) — no code interface, but the agent's actual drafting behavior depends on this file matching what `draftSectionsStep`'s prompt now asks for (S9/S10, EMD/IP/MSE).

- [ ] **Step 1: Extend the canonical section table**

In the "Canonical RFP section structure" table (currently ending at S8), add two rows after the S8 row:

```markdown
| S9 | GCC / GTC Annexures | annexure | Full text of the applicable General Conditions/Terms of Contract, selected by procurement category (goods/services/works). Pasted verbatim from the clause library — not freshly drafted. | Contract precedence (SCC/STC take precedence over this in case of conflict) |
| S10 | Commercial Annexures | annexure | Standard commercial formats (EMD/PBG bank guarantee format, Integrity Pact format, Bid Form, Price Schedule format). Pasted verbatim from the clause library. | Bid submission |
```

- [ ] **Step 2: Extend the S8 required-clause-depth list**

The S8 section currently says "S8 MUST contain **at least nine** substantive numbered clauses" and lists 9. Change the count and append three new numbered items, replacing that whole subsection with:

```markdown
## S8 — Contract Terms, Compliance & Security — required clause depth

S8 MUST contain **at least twelve** substantive numbered clauses:

1. **Payment terms**: Milestone-linked (e.g. 30% on delivery & installation; 40% on UAT
   sign-off; 30% on go-live + training). Payment released within 30 days of verified
   milestone. TDS deducted at source per applicable rates.
2. **Performance Bank Guarantee (PBG)**: 10% of contract value; unconditional from a
   scheduled commercial bank; valid until 60 days beyond warranty end; forfeitable on
   contractor default.
3. **Liquidated Damages**: 0.5% of contract value per week of delay, cap 10% of contract
   value; auto-deductible from pending invoices. LD does not limit other legal remedies.
4. **Warranty / AMC**: Minimum 1-year comprehensive warranty post go-live; defects rectified
   at no charge. AMC terms (rates, SLAs) apply if contract duration extends beyond warranty.
5. **Security & Compliance**: ISO 27001 mandatory; CERT-In empanelled third-party VAPT
   before go-live and annually thereafter; all data hosted within India on MeitY-empanelled
   infrastructure; DPDP Act 2023 compliant; audit logs retained 7 years.
6. **Confidentiality**: Vendor shall not disclose government data to any third party; bind
   sub-contractors to equivalent confidentiality; obligations survive contract expiry.
7. **Intellectual Property**: All deliverables, source code, documentation, and derivatives
   vest absolutely with the Government of Madhya Pradesh; vendor retains no proprietary
   rights over any deliverable funded under this contract.
8. **Termination**: For convenience — 30-day written notice, payment for accepted work
   done. For cause — material breach or insolvency; government may terminate immediately;
   vendor must return/destroy all government data within 15 days.
9. **Governing law & dispute resolution**: Governed by laws of India; exclusive jurisdiction
   of courts in Madhya Pradesh; arbitration under the Arbitration and Conciliation Act 1996;
   seat in Bhopal.
10. **Earnest Money Deposit (EMD)**: Applicable to goods/works procurement (not services);
    2% of estimated value; MSE-registered bidders are exempt on production of Udyam
    Registration. **Whether this clause applies is determined by the system's rules engine
    from the tender's category and value, not by your judgment** — if the mandatory-clause
    list you are given includes EMD, include it; otherwise omit it.
11. **Integrity Pact**: Mandatory for tenders valued at Rs. 1 Crore or above, per CVC
    guidelines. **Applicability is determined by the rules engine, not by your judgment** —
    include it only when instructed.
12. **MSE Participation & Exemption**: Always stated — EMD/tender-fee exemption and
    turnover/experience relaxation for MSE-registered bidders, per the Public Procurement
    Policy for MSEs Order 2012.

When the prompt includes a "MANDATORY S8 CLAUSES" block, use the exact `clauseNo` and
`libraryRef` given there for clauses 10–12 (and for clause 2, PBG, if a library reference is
supplied) — these are computed deterministically from the tender's value and category, not
drafted from scratch.
```

- [ ] **Step 3: Update the output-contract JSON example**

In the "Output contract" section's example JSON, add two more section objects after the S8 object, and add clause `8.10` to the S8 example so the shape stays self-consistent with the extended required-clause list:

```markdown
Add to S8's `clauses[]` array in the example, after `8.9`:
     {"clauseNo":"8.10","title":"Earnest Money Deposit (EMD)","text":"...","source":"library","libraryRef":"CL-021"}

Add after the S8 section object (before the closing `],"cvcFlags":...`):
  {"sectionNo":"S9","title":"General Conditions / Terms of Contract","blockType":"annexure",
   "content":{"text":"...","clauses":[]}},
  {"sectionNo":"S10","title":"Commercial Annexures","blockType":"annexure",
   "content":{"text":"...","clauses":[]}}
```

Also update the "Rules" list at the bottom of the output contract section — change `All 8 sections present in S1–S8 order; omit none.` to `All sections present in order: S1–S8 always; S9/S10 (annexures) when instructed by the MANDATORY ANNEXURE SECTIONS block in the prompt.` and add a new bullet: `S8 clauses[] MUST have at least 12 entries when EMD/Integrity Pact both apply (10 minimum otherwise — MSE is always present, PBG is always present).`

- [ ] **Step 4: Commit**

```bash
git add -f apps/relay/skills/tender-authoring/SKILL.md
git commit -m "docs(tender): extend authoring skill with EMD/Integrity Pact/MSE clauses and S9/S10 annexures"
```

(This repo force-adds docs past its `*.md` gitignore rule — same as every other plan/spec doc in this session. Confirm with `git check-ignore apps/relay/skills/tender-authoring/SKILL.md`; if it reports ignored, use `-f`.)

---

## Task 9: Web — annexure section rendering

**Files:**
- Modify: `apps/web/app/[tenant]/dashboard/tender-evaluation/[id]/authoring/components/RFPSection.tsx`

**Interfaces:**
- Consumes: `blockType: 'annexure'` sections now present in the `sections` array returned by `GET /api/proxy/api/v1/tender/authoring/:tenderId` (unchanged endpoint, new data shape from Task 6's `saveSectionsStep`).
- Produces: annexure sections render instead of falling through to the generic `<pre>{JSON.stringify(...)}</pre>` fallback.

- [ ] **Step 1: Add the `annexure` case to `SectionBody`**

In `RFPSection.tsx`, the `SectionBody` function currently starts with:
```tsx
function SectionBody({ blockType, content }: { blockType: string; content: SectionContent }) {
    if (blockType === "prose") {
        return <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{content.text ?? ""}</p>;
    }
```

Change the condition to also match `annexure` (annexure content uses the same `{text, clauses}` shape as prose per Task 5's prompt, so no new rendering logic is needed — just widen the match):

```tsx
function SectionBody({ blockType, content }: { blockType: string; content: SectionContent }) {
    if (blockType === "prose" || blockType === "annexure") {
        return <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{content.text ?? ""}</p>;
    }
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Since this depends on a running dashboard + relay (not unit-testable in isolation), verify once services are up (locally or on the VM per `TIER0-VERIFICATION-PLAN.md`): author a new RFP for a tender with `templateFields.category` set to "Goods" or "Works", confirm S9 and S10 sections appear in `AuthoringPanel`, render as prose-style text (not a raw JSON dump), and go through the same Accept/Edit/Regenerate/Export flow as S1–S8.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\[tenant\]/dashboard/tender-evaluation/\[id\]/authoring/components/RFPSection.tsx
git commit -m "feat(tender): render annexure-type RFP sections (S9/S10)"
```

---

## Task 10: Publish gate — reuse Document Checker

**Files:**
- Modify: `apps/api/src/routes/tenderAuthoring.ts` (the `POST /authoring/:id/publish` handler)

**Interfaces:**
- Consumes: `documentChecks` table (`@serverless-saas/database/schema/tender-document-check`, already built for Document Checker #2), `auditLog` table (already imported in this file).
- Produces: publish is blocked with 422 when any `documentChecks` row for the tender has `status: 'fail'`, unless `?override=true` is passed, in which case it proceeds and records `checksOverridden: true` in the audit log.

- [ ] **Step 1: Write the failing test**

Check whether `apps/api` has any existing route-level test file for `tenderAuthoring` to match its pattern (`grep -rn "tenderAuthoring" apps/api/src/**/__tests__ apps/api/**/*.test.ts 2>/dev/null`). If none exists, create one testing just the gate logic in isolation by extracting it into a small pure predicate function first (this keeps the test fast and DB-free, consistent with this codebase's preference for pure/testable logic where possible):

```typescript
// apps/api/src/routes/__tests__/tenderPublishGate.test.ts
import { describe, it, expect } from 'vitest';
import { evaluatePublishGate } from '../tenderPublishGate.js';

describe('evaluatePublishGate', () => {
  it('blocks when any check has failed and no override is given', () => {
    const result = evaluatePublishGate(
      [{ status: 'pass' }, { status: 'fail' }],
      false
    );
    expect(result.blocked).toBe(true);
  });

  it('allows when all checks pass', () => {
    const result = evaluatePublishGate([{ status: 'pass' }, { status: 'flagged' }], false);
    expect(result.blocked).toBe(false);
  });

  it('allows when checks have failed but override is true', () => {
    const result = evaluatePublishGate([{ status: 'fail' }], true);
    expect(result.blocked).toBe(false);
    expect(result.overridden).toBe(true);
  });

  it('allows when no checks have been run at all (nothing to gate on)', () => {
    const result = evaluatePublishGate([], false);
    expect(result.blocked).toBe(false);
  });

  it('overridden is false when override was not needed (no failures)', () => {
    const result = evaluatePublishGate([{ status: 'pass' }], true);
    expect(result.overridden).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/tenderPublishGate.test.ts`
Expected: FAIL — `Cannot find module '../tenderPublishGate.js'`.

- [ ] **Step 3: Write the pure gate function**

```typescript
// apps/api/src/routes/tenderPublishGate.ts

export interface PublishGateResult {
  blocked: boolean
  overridden: boolean
  failCount: number
}

export function evaluatePublishGate(
  checks: Array<{ status: 'pass' | 'fail' | 'flagged' }>,
  override: boolean
): PublishGateResult {
  const failCount = checks.filter(c => c.status === 'fail').length
  const hasFailure = failCount > 0

  if (!hasFailure) return { blocked: false, overridden: false, failCount: 0 }
  if (override) return { blocked: false, overridden: true, failCount }
  return { blocked: true, overridden: false, failCount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/tenderPublishGate.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Wire the gate into the publish route**

In `apps/api/src/routes/tenderAuthoring.ts`, add the import near the top (next to the other schema imports):
```typescript
import { documentChecks } from '@serverless-saas/database/schema/tender-document-check';
import { evaluatePublishGate } from './tenderPublishGate';
```

Replace the `POST /authoring/:id/publish` handler with:
```typescript
tenderAuthoringRoutes.post('/authoring/:id/publish', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const id = c.req.param('id');
  const override = c.req.query('override') === 'true';

  const [tender] = await db.select().from(tenders).where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);
  if (tender.status === 'published') return c.json({ error: 'already published' }, 409);

  const secs = await db.select({ acceptedAt: rfpSections.acceptedAt }).from(rfpSections)
    .where(and(eq(rfpSections.tenderId, id), eq(rfpSections.tenantId, tenantId)));
  if (!secs.length || secs.some((s: { acceptedAt: Date | null }) => !s.acceptedAt))
    return c.json({ error: `All ${secs.length} sections must be accepted before publishing` }, 422);

  const checks = await db.select({ status: documentChecks.status, ruleId: documentChecks.ruleId, message: documentChecks.message })
    .from(documentChecks)
    .where(and(eq(documentChecks.tenderId, id), eq(documentChecks.tenantId, tenantId)));
  const gate = evaluatePublishGate(checks, override);
  if (gate.blocked) {
    return c.json({
      error: `${gate.failCount} document check(s) failed. Resolve them or publish with ?override=true.`,
      failedChecks: checks.filter(ch => ch.status === 'fail'),
    }, 422);
  }

  const now = new Date();
  const tf = (tender.templateFields ?? {}) as Record<string, unknown>;
  await db.update(tenders)
    .set({ status: 'published', publishedAt: now, templateFields: { ...tf, publishedBy: userId }, updatedAt: now })
    .where(eq(tenders.id, id));
  await db.insert(auditLog).values({
    tenantId, actorId: userId, actorType: 'human', action: 'tender_publish', resource: 'tender', resourceId: id,
    metadata: { rfpNumber: tender.rfpNumber, sectionCount: secs.length, checksOverridden: gate.overridden, failedCheckCount: gate.failCount },
    traceId: (c.get('traceId') as string | undefined) ?? '',
  });
  return c.json({ ok: true, publishedAt: now.toISOString(), checksOverridden: gate.overridden });
});
```

- [ ] **Step 6: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/tenderPublishGate.ts apps/api/src/routes/__tests__/tenderPublishGate.test.ts apps/api/src/routes/tenderAuthoring.ts
git commit -m "feat(tender): gate Publish on Document Checker results, with audited officer override"
```

- [ ] **Step 8 (optional, cosmetic): Add an override checkbox to the publish confirm dialog**

In `apps/web/.../authoring/AuthoringPanel.tsx`, the `publishMutation` currently POSTs with no query param. This is a UI nicety, not required for the backend gate to function correctly (an officer can still hit the endpoint with `?override=true` directly, e.g. via a follow-up manual retry) — implement only if time remains after Tasks 1–9 and manual verification pass. Skipping this step does not block any other task.

---

## Self-Review

**Spec coverage:**
- (1) Rule-based clause auto-selection by material/value → Task 1 (`computeApplicableClauses`, category + value-band filtering).
- (2) EMD/PBG/Integrity Pact/MSE auto-application → Task 1 (rules JSON + `enforceRequiredClauses`), Task 2 (seed clauses), Task 5/7 (prompt injection), Task 8 (skill guidance).
- (3) GCC/GTC + commercial annexures → Task 1 (`annexureSets`/`commercialAnnexure`), Task 2 (seed clauses CL-024–027), Task 5 (S9/S10 in prompt/output schema), Task 8 (skill table), Task 9 (rendering).
- (4) Inter-module compatibility check before finalizing → Task 10 (Publish gate on existing `documentChecks`).
- "Generation becomes a real Mastra workflow" decision → Tasks 3–7.
- "Skill update" decision → Task 8.
- Testing section of the spec (rules unit tests, enforcement unit tests, publish-gate test) → Tasks 1 and 10 respectively.

**Placeholder scan:** none — every step has complete, non-abbreviated code. The one explicitly optional step (Task 10 Step 8) is marked optional with a stated reason, not a placeholder.

**Type consistency:**
- `computeApplicableClauses(tender: {budget: string | null}, templateFields)` signature is identical across Task 1's implementation, Task 4's `computeClauseRulesStep`, and Task 7's regenerate route.
- `enforceRequiredClauses(sections, mandatory, libraryRows)` signature and `RfpSectionLike`/`LibraryRowLike` shapes are identical across Task 1, Task 6's `enforceMandatoryClausesStep`, and Task 7's regenerate route (which passes a single-element array — the function's per-section `sectionNo !== 'S8'` check makes this safe with any array length).
- `MandatoryClause`/`AnnexureSpec` TS interfaces (Task 1) match `mandatoryClauseSchema`/`annexureSpecSchema` zod shapes (Task 3) field-for-field (`clauseNo`, `libraryRef`, `title`, `reason` / `sectionNo`, `title`, `libraryRef`).
- The workflow's data-passing chain is consistent: `computeClauseRulesStep` outputs `{tenderId, tenantId, mandatory, annexures}` → `draftSectionsStep` consumes exactly that shape and outputs `{..., sections, cvcFlags}` → `enforceMandatoryClausesStep` consumes and returns the same shape → `saveSectionsStep` consumes it and outputs `{tenderId, tenantId, sectionCount}`. Verified against each task's `Interfaces` block.
- `extractJsonObject` is defined once (Task 5) and imported (not redefined) by both the workflow step (Task 5) and the regenerate route (Task 7).
- `buildAuthoringPrompt` name is used consistently in Task 5's step file; Task 7 does not import it (regenerate builds its own single-section prompt inline, as stated in that task's Interfaces block) — no naming collision or unused-import risk.

No gaps found between the spec and the task list.
