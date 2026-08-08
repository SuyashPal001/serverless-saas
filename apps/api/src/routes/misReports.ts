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

  const withBidCounts = await Promise.all(contractRows.map(async (row: (typeof contractRows)[number]) => {
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

  const reportRows = report as unknown as Record<string, string | number>[];

  if (format === 'csv') {
    const csv = toCsv(reportRows, headers);
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="major-contracts-report.csv"');
    return c.body(csv);
  }
  const html = toHtmlTable(reportRows, headers, 'Major Contracts / POs Report');
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

  const reportRows = report as unknown as Record<string, string | number>[];

  if (format === 'csv') {
    const csv = toCsv(reportRows, headers);
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="spend-by-category-report.csv"');
    return c.body(csv);
  }
  const html = toHtmlTable(reportRows, headers, 'Spend by Category Report');
  c.header('Content-Type', 'text/html');
  return c.body(html);
});
