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
