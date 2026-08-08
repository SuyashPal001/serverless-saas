# MIS Reporting — Export Layer (#12, thin slice) — design

## Context

OIL microservice #12, "MIS report generation," is not started (`OIL-SCOPE-GAP-PLAN.md` §1) — only `reportAssemble.ts` exists, which produces a single tender-evaluation eval report, not an MIS system. Per the gap plan's original Tier 2 scoping: "do the export layer (PDF/Excel from existing tender data) now for demo; scheduled/distributed MIS from SAP is post-award." This spec covers exactly that thin slice — no OIL dependency, uses data already in the DB from this week's bid-evaluation and contract-formulation work.

Full OIL scope for this item: major contracts/POs report (vendor details, #bids, TA/CA accepted bids, vendors participated), #tenders delayed (weekly/monthly/quarterly/yearly), total spend by procurement category, output formats PDF/Excel/HTML, scheduled generation, distribution to e-notesheet/email/dashboard, archiving with versioning and source-link retention.

## Decisions locked during brainstorming

- **Two reports only: Major Contracts/POs and Spend by Category.** "#Tenders delayed" is dropped from this pass — there is no due-date/SLA field anywhere on the `tenders` table today, so "delayed" would have to be an invented heuristic rather than a real signal. Adding real SLA/due-date tracking is its own small design decision, not something to bolt on silently inside an export-layer task.
- **CSV for the spreadsheet format, not a real `.xlsx`.** No `.xlsx` library exists in this repo. The existing "Word export" (`tenderAuthoring.ts`, `tenderContractExport.ts`) is already an HTML-with-`.doc`-extension trick — zero dependencies. CSV is the equivalent zero-dependency move for spreadsheets (Excel/Sheets open it natively), matching this week's "no new dependencies" pattern across every other feature.
- **PDF via the same HTML-with-correct-Content-Type trick**, relying on the browser's own Print-to-PDF rather than adding a PDF-generation library.
- **Independent of the Vendor Database plan** (spec: `2026-08-08-vendor-database-design.md`, not yet implemented). Report 1 reads `bidders.name`/`displayLabel` directly, not through a `vendors` join — either plan can be implemented first, or in either order. If Vendor Database lands later, enriching Report 1 with vendor category/blacklist status is a small follow-up, not this pass's problem.
- **Archiving/versioning deferred entirely.** Generate-on-demand only, no `generatedReports` log table. Matches the gap plan's own phasing (scheduled/archived MIS is the SAP-fed, post-award phase).
- **New dashboard page** (`/[tenant]/dashboard/reports`), not API-only and not bolted onto existing pages — matches this week's pattern (Vendor Database also got its own page).

## Architecture

### 1. Report builders (new, pure)

`apps/api/src/routes/misReports.ts` (or a separate `misReportBuilders.ts` if the file grows large — resolved during planning):

```ts
export interface ContractsReportRow {
  rfpNumber: string
  title: string
  department: string
  awardedVendorName: string
  contractValue: number
  totalBids: number
  qualifiedBids: number
  awardedAt: string // ISO date
}

export function buildContractsReport(
  rows: Array<{
    rfpNumber: string; title: string; department: string
    contractorName: string; contractValue: string
    totalBids: number; qualifiedBids: number
    generatedAt: Date
  }>
): ContractsReportRow[]

export interface SpendByCategoryRow {
  category: string
  tenderCount: number
  totalSpend: number
}

export function buildSpendByCategoryReport(
  rows: Array<{ category: string; contractValue: string }>
): SpendByCategoryRow[]
```

Both are pure: DB rows in (already joined/queried by the calling route), formatted report rows out. No DB access, no I/O — independently unit-testable with fixture arrays.

### 2. Data queries (in the API route, not the pure builders)

**Contracts report query:** for each tenant, the latest version of each tender's `tenderContracts` row, joined to `tenders` (for `rfpNumber`/`title`/`department`) and to a per-tender `bidders` count (total + non-`pq_disqualified`). Optional date-range filter on `tenderContracts.generatedAt`.

**Spend-by-category query:** the latest `tenderContracts` version per tender, joined to `tenders.templateFields->>'category'`, grouped by category.

"Latest version per tender" reuses the same `max(version)` pattern already established in `tenderContract.ts`'s `generateContract` (append-only, versioned tables — `tender_contracts_tender_id_version_unique`).

### 3. Export serializers (new, generic, zero-dependency)

`apps/api/src/routes/exportFormat.ts`:

```ts
export function toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string
export function toHtmlTable(rows: Array<Record<string, string | number>>, headers: string[], title: string): string
```

`toCsv` handles standard CSV escaping (quote fields containing commas/quotes/newlines). `toHtmlTable` produces a minimal styled HTML page (same inline-style approach as `buildExportHtml`) suitable for browser Print-to-PDF. Both are generic — not report-specific — so they serve both reports without duplication.

### 4. API routes

`apps/api/src/routes/misReports.ts`:
- `GET /reports/contracts?format=csv|html&from=&to=` — runs the contracts query, `buildContractsReport`, then serializes via `toCsv`/`toHtmlTable` depending on `format`.
- `GET /reports/spend-by-category?format=csv|html&from=&to=` — same shape for the spend report.

Response `Content-Type` and `Content-Disposition` headers follow the existing export-route convention (`text/csv` + `attachment; filename=...` for CSV, `text/html` for the print view — no `Content-Disposition` on HTML so it renders inline for printing, matching how `buildExportHtml`'s caller already works).

### 5. Web UI

`/[tenant]/dashboard/reports` — new page. Two report cards (Contracts/POs, Spend by Category), each with an optional date-range picker and "Export CSV" / "Print / Export PDF" buttons (the latter opens the HTML export in a new tab, letting the browser's native print dialog handle PDF). Styled like the Vendor Database page (plain cards, no chart library — this is a tabular MIS export, not a dashboard visualization).

## Data flow

```
GET /reports/contracts?format=csv
        │
        ▼
query: tenderContracts (latest version per tender)
   ⋈ tenders (rfpNumber, title, department, templateFields.category)
   ⋈ bidders count (total, qualified) per tender
        │
        ▼
buildContractsReport(rows)  ──►  ContractsReportRow[]
        │
        ▼
toCsv(rows, headers)  or  toHtmlTable(rows, headers, title)
        │
        ▼
HTTP response (text/csv attachment, or text/html inline)
```

## Error handling

- Empty result set (no contracts generated yet for this tenant) is a valid, non-error case — both report builders return `[]`, and both serializers produce a header-only CSV / an HTML table with a "No data" row, not a 4xx/5xx.
- Invalid `format` query param (anything other than `csv`/`html`) returns 400.
- Invalid `from`/`to` date params (unparseable) are ignored (treated as "no filter" for that bound) rather than erroring — a malformed date shouldn't block viewing the report, just fail to filter.

## Testing

- `buildContractsReport` — unit tests: empty input → `[]`; single row maps fields correctly (numeric `contractValue` string → number); multiple rows preserve order from input.
- `buildSpendByCategoryReport` — unit tests: empty input → `[]`; multiple tenders in the same category sum correctly; multiple categories produce separate rows; a tender with no `category` in `templateFields` falls into a documented default bucket (e.g. `"Uncategorized"`), not dropped silently.
- `toCsv` — unit tests: correct escaping of a field containing a comma, a field containing a double quote, and a field containing a newline; header row present; empty rows array produces header-only output.
- `toHtmlTable` — unit test: valid HTML structure (balanced tags), header row present, "No data" row when rows is empty.

## Out of scope (explicitly deferred)

- "#Tenders delayed" report (no real due-date/SLA signal exists today — see decisions above).
- Real `.xlsx` binary export (CSV instead, per decision above).
- Scheduled/periodic generation, distribution to e-notesheet/email/dashboard on a schedule (named in the OIL scope doc as part of the SAP-fed phase, not this demo-ready slice).
- Archiving with versioning and source-link retention (deferred per decision above).
- Vendor-master enrichment of Report 1 (depends on the separately-planned Vendor Database feature; this report reads `bidders` directly for independence).
- Live verification — subject to the same Tier 0 VM-verification blocker as everything else built this week ([[project_pending_tier0_vm]]); code-complete + unit-tested is the bar for this pass.
