# MIS Reporting Export Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OIL RFP item #12 "MIS report generation" export layer (thin slice) — two on-demand reports (Major Contracts/POs, Spend by Category) generated from existing tender/bid/contract data, exportable as CSV or a print-ready HTML page, surfaced on a new dashboard page.

**Architecture:** Two pure "report builder" functions (DB rows in, formatted report rows out — unit-tested, no I/O) plus two generic, report-agnostic export serializers (`toCsv`, `toHtmlTable`), wired into two new API routes and one new dashboard page. Reuses the existing zero-dependency "serve HTML with the right headers" export pattern already established by `tenderContractExport.ts`/`tenderProposalExport.ts` — no new libraries.

**Tech Stack:** Drizzle ORM + Postgres, Hono routes, vitest, Next.js/React — all already in use; no new dependencies.

## Global Constraints

- Work on branch `develop` in `serverless-saas/` — never `master`/`main`.
- Every DB query must filter by `tenantId` (tenancy invariant enforced across the whole codebase).
- No new runtime dependencies — CSV instead of a real `.xlsx` library, HTML-print instead of a PDF library (per spec decision).
- This plan is independent of `docs/superpowers/plans/2026-08-08-vendor-database.md` — Report 1 reads `bidders` directly, no `vendors` join. Either plan may be implemented first.
- No placeholder code, no TODOs — every step below is complete, runnable code.

---

## Task 1: Report builders — pure functions + tests

**Files:**
- Create: `apps/api/src/routes/misReportBuilders.ts`
- Create: `apps/api/src/routes/__tests__/misReportBuilders.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB dependency).
- Produces: `buildContractsReport(rows: ContractsReportInputRow[]): ContractsReportRow[]`, `buildSpendByCategoryReport(rows: SpendInputRow[]): SpendByCategoryRow[]` — consumed by Task 3's API routes.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/misReportBuilders.test.ts
import { describe, it, expect } from 'vitest';
import { buildContractsReport, buildSpendByCategoryReport } from '../misReportBuilders.js';

describe('buildContractsReport', () => {
  it('returns an empty array for empty input', () => {
    expect(buildContractsReport([])).toEqual([]);
  });

  it('maps a single row correctly, converting contractValue string to number', () => {
    const result = buildContractsReport([{
      rfpNumber: 'DIT/HRMS/2024-25/001', title: 'HRMS Implementation', department: 'Department of IT',
      contractorName: 'Meridian Instrumentation Pvt Ltd', contractValue: '5000000.50',
      totalBids: 4, qualifiedBids: 3, generatedAt: new Date('2026-06-15T00:00:00Z'),
    }]);
    expect(result).toEqual([{
      rfpNumber: 'DIT/HRMS/2024-25/001', title: 'HRMS Implementation', department: 'Department of IT',
      awardedVendorName: 'Meridian Instrumentation Pvt Ltd', contractValue: 5000000.5,
      totalBids: 4, qualifiedBids: 3, awardedAt: '2026-06-15T00:00:00.000Z',
    }]);
  });

  it('preserves input row order across multiple rows', () => {
    const result = buildContractsReport([
      { rfpNumber: 'A', title: 'a', department: 'd', contractorName: 'c1', contractValue: '100', totalBids: 1, qualifiedBids: 1, generatedAt: new Date('2026-01-01T00:00:00Z') },
      { rfpNumber: 'B', title: 'b', department: 'd', contractorName: 'c2', contractValue: '200', totalBids: 2, qualifiedBids: 2, generatedAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    expect(result.map(r => r.rfpNumber)).toEqual(['A', 'B']);
  });
});

describe('buildSpendByCategoryReport', () => {
  it('returns an empty array for empty input', () => {
    expect(buildSpendByCategoryReport([])).toEqual([]);
  });

  it('sums contract values for tenders in the same category', () => {
    const result = buildSpendByCategoryReport([
      { category: 'IT/Software', contractValue: '1000000' },
      { category: 'IT/Software', contractValue: '2500000' },
    ]);
    expect(result).toEqual([{ category: 'IT/Software', tenderCount: 2, totalSpend: 3500000 }]);
  });

  it('produces separate rows for separate categories', () => {
    const result = buildSpendByCategoryReport([
      { category: 'IT/Software', contractValue: '1000000' },
      { category: 'Civil Works', contractValue: '5000000' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.category === 'IT/Software')).toEqual({ category: 'IT/Software', tenderCount: 1, totalSpend: 1000000 });
    expect(result.find(r => r.category === 'Civil Works')).toEqual({ category: 'Civil Works', tenderCount: 1, totalSpend: 5000000 });
  });

  it('buckets a null/empty category under "Uncategorized"', () => {
    const result = buildSpendByCategoryReport([
      { category: null, contractValue: '1000000' },
      { category: '', contractValue: '500000' },
    ]);
    expect(result).toEqual([{ category: 'Uncategorized', tenderCount: 2, totalSpend: 1500000 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/misReportBuilders.test.ts`
Expected: FAIL — `Cannot find module '../misReportBuilders.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/misReportBuilders.ts

export interface ContractsReportInputRow {
  rfpNumber: string
  title: string
  department: string
  contractorName: string
  contractValue: string
  totalBids: number
  qualifiedBids: number
  generatedAt: Date
}

export interface ContractsReportRow {
  rfpNumber: string
  title: string
  department: string
  awardedVendorName: string
  contractValue: number
  totalBids: number
  qualifiedBids: number
  awardedAt: string
}

export function buildContractsReport(rows: ContractsReportInputRow[]): ContractsReportRow[] {
  return rows.map(r => ({
    rfpNumber: r.rfpNumber,
    title: r.title,
    department: r.department,
    awardedVendorName: r.contractorName,
    contractValue: Number(r.contractValue),
    totalBids: r.totalBids,
    qualifiedBids: r.qualifiedBids,
    awardedAt: r.generatedAt.toISOString(),
  }));
}

export interface SpendInputRow {
  category: string | null
  contractValue: string
}

export interface SpendByCategoryRow {
  category: string
  tenderCount: number
  totalSpend: number
}

export function buildSpendByCategoryReport(rows: SpendInputRow[]): SpendByCategoryRow[] {
  const byCategory = new Map<string, { tenderCount: number; totalSpend: number }>();

  for (const row of rows) {
    const category = row.category && row.category.trim() ? row.category : 'Uncategorized';
    const existing = byCategory.get(category) ?? { tenderCount: 0, totalSpend: 0 };
    existing.tenderCount += 1;
    existing.totalSpend += Number(row.contractValue);
    byCategory.set(category, existing);
  }

  return Array.from(byCategory.entries()).map(([category, v]) => ({ category, ...v }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/misReportBuilders.test.ts`
Expected: PASS, 7/7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/misReportBuilders.ts apps/api/src/routes/__tests__/misReportBuilders.test.ts
git commit -m "feat(mis): report builder pure functions — contracts + spend-by-category"
```

---

## Task 2: Export serializers — pure functions + tests

**Files:**
- Create: `apps/api/src/routes/exportFormat.ts`
- Create: `apps/api/src/routes/__tests__/exportFormat.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string`, `toHtmlTable(rows: Array<Record<string, string | number>>, headers: string[], title: string): string` — consumed by Task 3's API routes.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/exportFormat.test.ts
import { describe, it, expect } from 'vitest';
import { toCsv, toHtmlTable } from '../exportFormat.js';

describe('toCsv', () => {
  it('produces a header-only output for empty rows', () => {
    expect(toCsv([], ['name', 'value'])).toBe('name,value\n');
  });

  it('serializes simple rows', () => {
    const result = toCsv([{ name: 'Alpha', value: 100 }, { name: 'Beta', value: 200 }], ['name', 'value']);
    expect(result).toBe('name,value\nAlpha,100\nBeta,200\n');
  });

  it('quotes a field containing a comma', () => {
    const result = toCsv([{ name: 'Alpha, Inc.', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"Alpha, Inc.",1\n');
  });

  it('quotes and escapes a field containing a double quote', () => {
    const result = toCsv([{ name: 'The "Best" Vendor', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"The ""Best"" Vendor",1\n');
  });

  it('quotes a field containing a newline', () => {
    const result = toCsv([{ name: 'Line1\nLine2', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"Line1\nLine2",1\n');
  });
});

describe('toHtmlTable', () => {
  it('produces valid HTML with a header row and title', () => {
    const html = toHtmlTable([{ name: 'Alpha', value: 100 }], ['name', 'value'], 'Test Report');
    expect(html).toContain('<title>Test Report</title>');
    expect(html).toContain('<th>name</th>');
    expect(html).toContain('<th>value</th>');
    expect(html).toContain('<td>Alpha</td>');
    expect(html).toContain('<td>100</td>');
    expect(html).toMatch(/<table[\s\S]*<\/table>/);
  });

  it('shows a "No data" row when rows is empty', () => {
    const html = toHtmlTable([], ['name', 'value'], 'Empty Report');
    expect(html).toContain('No data');
  });

  it('escapes HTML-unsafe characters in cell values', () => {
    const html = toHtmlTable([{ name: '<script>alert(1)</script>', value: 1 }], ['name', 'value'], 'XSS Test');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/exportFormat.test.ts`
Expected: FAIL — `Cannot find module '../exportFormat.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/exportFormat.ts

function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map(row => headers.map(h => csvField(row[h] ?? '')).join(','));
  return [headerLine, ...dataLines].join('\n') + '\n';
}

function escHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toHtmlTable(rows: Array<Record<string, string | number>>, headers: string[], title: string): string {
  const headerHtml = headers.map(h => `<th>${escHtml(h)}</th>`).join('');
  const bodyHtml = rows.length
    ? rows.map(row => `<tr>${headers.map(h => `<td>${escHtml(row[h] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" style="text-align:center;color:#888">No data</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; font-size: 11pt; }
  h1 { text-align: center; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th, td { border: 1px solid #666; padding: 6px 8px; font-size: 10pt; text-align: left; }
  th { background: #e8e8e8; font-weight: bold; }
</style>
</head><body>
<h1>${escHtml(title)}</h1>
<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/exportFormat.test.ts`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/exportFormat.ts apps/api/src/routes/__tests__/exportFormat.test.ts
git commit -m "feat(mis): generic CSV + HTML-table export serializers"
```

---

## Task 3: API routes

**Files:**
- Create: `apps/api/src/routes/misReports.ts`
- Modify: `apps/api/src/app.ts` (add import near line 42, add `.route()` call near line 239)

**Interfaces:**
- Consumes: `buildContractsReport`, `buildSpendByCategoryReport` (Task 1), `toCsv`, `toHtmlTable` (Task 2), `tenders`, `tenderContracts`, `bidders` tables from `@serverless-saas/database`, same `requestContext` pattern as `apps/api/src/routes/vendors.ts`.
- Produces: `GET /reports/contracts?format=csv|html&from=&to=`, `GET /reports/spend-by-category?format=csv|html&from=&to=` — consumed by Task 4's web UI.

- [ ] **Step 1: Write the route**

```typescript
// apps/api/src/routes/misReports.ts
import { Hono } from 'hono';
import { db, tenders, tenderContracts, bidders } from '@serverless-saas/database';
import { eq, and, gte, lte, max, ne, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';
import { buildContractsReport, buildSpendByCategoryReport } from './misReportBuilders';
import { toCsv, toHtmlTable } from './exportFormat';

export const misReportsRoutes = new Hono<AppEnv>();

function parseDateParam(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function dateRangeConditions(from: Date | null, to: Date | null) {
  const conditions = [];
  if (from) conditions.push(gte(tenderContracts.generatedAt, from));
  if (to) conditions.push(lte(tenderContracts.generatedAt, to));
  return conditions;
}

// GET /reports/contracts — major contracts/POs report
misReportsRoutes.get('/contracts', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const format = c.req.query('format') === 'csv' ? 'csv' : 'html';
  const from = parseDateParam(c.req.query('from'));
  const to = parseDateParam(c.req.query('to'));

  // Latest contract version per tender
  const latestVersions = db.$with('latest_versions').as(
    db.select({ tenderId: tenderContracts.tenderId, maxVersion: max(tenderContracts.version).as('max_version') })
      .from(tenderContracts)
      .where(eq(tenderContracts.tenantId, tenantId))
      .groupBy(tenderContracts.tenderId)
  );

  const contractRows = await db.with(latestVersions)
    .select({
      rfpNumber: tenders.rfpNumber, title: tenders.title, department: tenders.department,
      contractorName: tenderContracts.contractorName, contractValue: tenderContracts.contractValue,
      generatedAt: tenderContracts.generatedAt, tenderId: tenderContracts.tenderId,
    })
    .from(tenderContracts)
    .innerJoin(latestVersions, and(
      eq(latestVersions.tenderId, tenderContracts.tenderId),
      eq(latestVersions.maxVersion, tenderContracts.version),
    ))
    .innerJoin(tenders, eq(tenders.id, tenderContracts.tenderId))
    .where(and(eq(tenderContracts.tenantId, tenantId), ...dateRangeConditions(from, to)));

  const withBidCounts = await Promise.all(contractRows.map(async (row) => {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(bidders)
      .where(and(eq(bidders.tenderId, row.tenderId), eq(bidders.tenantId, tenantId)));
    const [{ qualified }] = await db.select({ qualified: sql<number>`count(*)::int` }).from(bidders)
      .where(and(eq(bidders.tenderId, row.tenderId), eq(bidders.tenantId, tenantId), ne(bidders.status, 'pq_disqualified')));
    return { ...row, totalBids: total, qualifiedBids: qualified };
  }));

  const report = buildContractsReport(withBidCounts.map(r => ({
    rfpNumber: r.rfpNumber, title: r.title, department: r.department,
    contractorName: r.contractorName, contractValue: r.contractValue,
    totalBids: r.totalBids, qualifiedBids: r.qualifiedBids, generatedAt: r.generatedAt,
  })));

  const headers = ['rfpNumber', 'title', 'department', 'awardedVendorName', 'contractValue', 'totalBids', 'qualifiedBids', 'awardedAt'];

  if (format === 'csv') {
    const csv = toCsv(report, headers);
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="major-contracts-report.csv"');
    return c.body(csv);
  }
  const html = toHtmlTable(report, headers, 'Major Contracts / POs Report');
  c.header('Content-Type', 'text/html');
  return c.body(html);
});

// GET /reports/spend-by-category — total spend grouped by procurement category
misReportsRoutes.get('/spend-by-category', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const format = c.req.query('format') === 'csv' ? 'csv' : 'html';
  const from = parseDateParam(c.req.query('from'));
  const to = parseDateParam(c.req.query('to'));

  const latestVersions = db.$with('latest_versions').as(
    db.select({ tenderId: tenderContracts.tenderId, maxVersion: max(tenderContracts.version).as('max_version') })
      .from(tenderContracts)
      .where(eq(tenderContracts.tenantId, tenantId))
      .groupBy(tenderContracts.tenderId)
  );

  const rows = await db.with(latestVersions)
    .select({
      category: sql<string | null>`${tenders.templateFields}->>'category'`,
      contractValue: tenderContracts.contractValue,
    })
    .from(tenderContracts)
    .innerJoin(latestVersions, and(
      eq(latestVersions.tenderId, tenderContracts.tenderId),
      eq(latestVersions.maxVersion, tenderContracts.version),
    ))
    .innerJoin(tenders, eq(tenders.id, tenderContracts.tenderId))
    .where(and(eq(tenderContracts.tenantId, tenantId), ...dateRangeConditions(from, to)));

  const report = buildSpendByCategoryReport(rows);
  const headers = ['category', 'tenderCount', 'totalSpend'];

  if (format === 'csv') {
    const csv = toCsv(report, headers);
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="spend-by-category-report.csv"');
    return c.body(csv);
  }
  const html = toHtmlTable(report, headers, 'Spend by Category Report');
  c.header('Content-Type', 'text/html');
  return c.body(html);
});
```

- [ ] **Step 2: Mount the route**

In `apps/api/src/app.ts`, add the import next to the other route imports (after the `vendorsRoutes` import from the Vendor Database plan, if that's already merged — otherwise after the last `Routes` import, around line 42):
```typescript
import { misReportsRoutes } from './routes/misReports';
```
And add the mount next to the other top-level resource mounts (after `api.route('/pages', pagesRoutes);` around line 239):
```typescript
api.route('/reports', misReportsRoutes);
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/misReports.ts apps/api/src/app.ts
git commit -m "feat(mis): contracts + spend-by-category report API routes"
```

---

## Task 4: Web dashboard page

**Files:**
- Create: `apps/web/app/[tenant]/dashboard/reports/page.tsx`

**Interfaces:**
- Consumes: `GET /api/proxy/api/v1/reports/contracts`, `GET /api/proxy/api/v1/reports/spend-by-category` (Task 3). No `useQuery` needed — these are direct-download/print links, not data fetched into the page.

- [ ] **Step 1: Write the page**

```tsx
// apps/web/app/[tenant]/dashboard/reports/page.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

interface ReportCardProps {
  title: string;
  description: string;
  endpoint: string;
  fromDate: string;
  toDate: string;
}

function ReportCard({ title, description, endpoint, fromDate, toDate }: ReportCardProps) {
  function buildUrl(format: "csv" | "html") {
    const params = new URLSearchParams({ format });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return `/api/proxy/api/v1${endpoint}?${params.toString()}`;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        <a href={buildUrl("csv")} download>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </a>
        <a href={buildUrl("html")} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Printer className="w-3.5 h-3.5" /> Print / Export PDF
          </Button>
        </a>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold text-foreground">MIS Reports</h1>

      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="ml-2 text-xs bg-background border border-border rounded px-2 py-1 text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="ml-2 text-xs bg-background border border-border rounded px-2 py-1 text-foreground" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ReportCard
          title="Major Contracts / POs"
          description="Awarded contracts with vendor details, bid counts, and contract value."
          endpoint="/reports/contracts"
          fromDate={fromDate}
          toDate={toDate}
        />
        <ReportCard
          title="Spend by Category"
          description="Total contract spend grouped by procurement category."
          endpoint="/reports/spend-by-category"
          fromDate={fromDate}
          toDate={toDate}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Since this depends on a running dashboard + API (not unit-testable in isolation), verify once services are up (locally or on the VM per `TIER0-VERIFICATION-PLAN.md`):
1. Navigate to `/[tenant]/dashboard/reports` — confirm both report cards render.
2. Click "Export CSV" on Major Contracts/POs — confirm a `.csv` file downloads with correct headers and one row per generated contract in the tenant.
3. Click "Print / Export PDF" — confirm a new tab opens with a formatted HTML table, printable via the browser's own print dialog.
4. Set a date range that excludes all existing contracts — confirm the CSV is header-only and the HTML shows "No data".
5. Repeat both exports for Spend by Category — confirm totals match a manual sum of `tenderContracts.contractValue` for tenants with generated contracts.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\[tenant\]/dashboard/reports/
git commit -m "feat(mis): MIS reports dashboard page"
```

---

## Self-Review

**Spec coverage:**
- Major Contracts/POs report (vendor details, #bids, TA/CA accepted, vendors participated) → Task 1 (`buildContractsReport`) + Task 3 (contracts query joining `tenders`/`tenderContracts`/`bidders`). "TA/CA accepted" is represented as `qualifiedBids` (bidders not `pq_disqualified`) per the spec's grounding in real bid-status data, not an invented TA/CA-specific field that doesn't exist in the schema.
- Total spend by procurement category → Task 1 (`buildSpendByCategoryReport`) + Task 3 (spend-by-category query reading `tenders.templateFields->>'category'`).
- CSV + HTML/PDF output formats → Task 2 (`toCsv`, `toHtmlTable`), wired into both routes in Task 3.
- New dashboard page → Task 4.
- "#Tenders delayed" — explicitly out of scope per the spec's decision (no real due-date signal exists); no task implements it, and none should.
- Archiving/versioning — explicitly deferred per the spec; no task implements it.
- Independence from Vendor Database — confirmed: Task 3's queries read `bidders`/`tenders`/`tenderContracts` only, no `vendors` table reference anywhere in this plan.

**Placeholder scan:** none — every step has complete code.

**Type consistency:**
- `buildContractsReport(rows: ContractsReportInputRow[]): ContractsReportRow[]` (Task 1) matches exactly how Task 3 calls it (`contractorName`, `contractValue` as string, `generatedAt` as `Date`, `totalBids`/`qualifiedBids` as numbers).
- `buildSpendByCategoryReport(rows: SpendInputRow[]): SpendByCategoryRow[]` (Task 1) matches Task 3's query result shape (`category: string | null`, `contractValue: string`).
- `toCsv`/`toHtmlTable` signatures (Task 2) match both call sites in Task 3 exactly (`Array<Record<string, string | number>>`, `headers: string[]`, and `title` for the HTML variant).
- Both API route response headers (`Content-Type`/`Content-Disposition` for CSV, `Content-Type` only for HTML) follow the same convention as the existing `tenderContractExport.ts` caller in `tenderContract.ts:87-88`.

No gaps found between the spec and the task list.
