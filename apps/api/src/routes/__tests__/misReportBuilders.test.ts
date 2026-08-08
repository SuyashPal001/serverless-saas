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
