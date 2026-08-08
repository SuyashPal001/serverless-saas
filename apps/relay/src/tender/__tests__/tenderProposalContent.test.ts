import { describe, it, expect } from 'vitest';
import { buildProposalContent, type ProposalContentInput } from '../tenderProposalContent.js';

const baseInput: ProposalContentInput = {
  tender: { rfpNumber: 'MP-DIT/HRMS/2024-25/001', title: 'HRMS Procurement', department: 'Dept of IT', budget: '80000000' },
  bidders: [
    { id: 'b1', name: 'InfraVision Technologies', displayLabel: 'Bidder A' },
    { id: 'b2', name: 'TechAxis Solutions', displayLabel: 'Bidder B' },
    { id: 'b3', name: 'NovaSys Integrators', displayLabel: 'Bidder C' },
  ],
  pqFindings: [
    { id: 'pq1', bidderId: 'b1', status: 'qualified', ruleName: 'Turnover', narration: 'Meets threshold' },
    { id: 'pq2', bidderId: 'b2', status: 'not_qualified', ruleName: 'Turnover', narration: 'Below ₹5 Cr threshold' },
    { id: 'pq3', bidderId: 'b3', status: 'qualified', ruleName: 'Turnover', narration: 'Meets threshold' },
  ],
  technicalFindings: [
    { bidderId: 'b1', status: 'deviation' },
    { bidderId: 'b1', status: 'complied' },
    { bidderId: 'b3', status: 'complied' },
    { bidderId: 'b3', status: 'complied' },
  ],
  financialFindings: [
    { bidderId: 'b1', correctedTotal: '78200000', isL1: 'yes' },
    { bidderId: 'b3', correctedTotal: '82000000', isL1: 'no' },
  ],
  shortfalls: [
    { bidderId: 'b1', discrepancy: 'Missing OEM authorization letter', status: 'closed' },
  ],
};

describe('buildProposalContent', () => {
  it('marks a not_qualified bidder as disqualified in the compliance matrix', () => {
    const content = buildProposalContent(baseInput);
    const row = content.complianceMatrix.find(r => r.bidderId === 'b2')!;
    expect(row.pqStatus).toBe('not_qualified');
    expect(row.disqualified).toBe(true);
  });

  it('does not disqualify a qualified bidder with technical deviations', () => {
    const content = buildProposalContent(baseInput);
    const row = content.complianceMatrix.find(r => r.bidderId === 'b1')!;
    expect(row.pqStatus).toBe('qualified');
    expect(row.disqualified).toBe(false);
    expect(row.techDeviations).toBe(1);
    expect(row.techComplied).toBe(1);
  });

  it('computes price variance against the internal estimate (tender budget)', () => {
    const content = buildProposalContent(baseInput);
    expect(content.priceComparison.internalEstimate).toBe(80000000);
    const l1Row = content.priceComparison.rows.find(r => r.bidderId === 'b1')!;
    // (78200000 - 80000000) / 80000000 * 100 = -2.25
    expect(l1Row.varianceFromEstimatePct).toBeCloseTo(-2.25, 2);
    expect(l1Row.isL1).toBe(true);
  });

  it('returns null variance when the tender has no budget set', () => {
    const content = buildProposalContent({ ...baseInput, tender: { ...baseInput.tender, budget: null } });
    expect(content.priceComparison.internalEstimate).toBeNull();
    expect(content.priceComparison.rows.every(r => r.varianceFromEstimatePct === null)).toBe(true);
  });

  it('builds rejection grounds only for disqualified bidders, citing the failing PQ narration', () => {
    const content = buildProposalContent(baseInput);
    expect(content.rejectionGrounds).toHaveLength(1);
    expect(content.rejectionGrounds[0].bidderId).toBe('b2');
    expect(content.rejectionGrounds[0].reasons[0]).toContain('Below ₹5 Cr threshold');
  });

  it('excludes financially-unevaluated bidders from price comparison rows', () => {
    const content = buildProposalContent(baseInput);
    expect(content.priceComparison.rows.map(r => r.bidderId)).not.toContain('b2');
    expect(content.priceComparison.rows).toHaveLength(2);
  });

  it('produces a deterministic exec summary mentioning bidder count, L1 winner, and disqualified count', () => {
    const content = buildProposalContent(baseInput);
    expect(content.execSummary).toContain('3');
    expect(content.execSummary).toContain('InfraVision');
    expect(content.execSummary).toContain('1');
  });

  it('sets recommendation from the L1 bidder when one exists', () => {
    const content = buildProposalContent(baseInput);
    expect(content.recommendation).toContain('InfraVision');
  });

  it('handles the case with no L1 bidder (financial evaluation incomplete)', () => {
    const content = buildProposalContent({ ...baseInput, financialFindings: [] });
    expect(content.recommendation).toContain('not');
    expect(content.priceComparison.rows).toHaveLength(0);
  });

  it('does not disqualify a bidder whose failing PQ finding was officer-overridden', () => {
    const content = buildProposalContent({
      ...baseInput,
      pqOverrides: [{ findingId: 'pq2', rationale: 'Turnover shortfall waived per Committee minute dated 2026-08-01' }],
    });
    const row = content.complianceMatrix.find(r => r.bidderId === 'b2')!;
    expect(row.pqStatus).toBe('not_qualified'); // factual finding is unchanged
    expect(row.disqualified).toBe(false); // but the operative outcome is overridden
    expect(row.overridden).toBe(true);
    expect(row.overrideRationale).toContain('Committee minute');
  });

  it('excludes an overridden bidder from rejection grounds', () => {
    const content = buildProposalContent({
      ...baseInput,
      pqOverrides: [{ findingId: 'pq2', rationale: 'Waived' }],
    });
    expect(content.rejectionGrounds).toHaveLength(0);
  });

  it('only overrides the specific finding id, not every not_qualified finding for the bidder', () => {
    const content = buildProposalContent({
      ...baseInput,
      pqFindings: [
        ...baseInput.pqFindings,
        { id: 'pq2b', bidderId: 'b2', status: 'not_qualified', ruleName: 'Experience', narration: 'Below 3-year requirement' },
      ],
      pqOverrides: [{ findingId: 'pq2', rationale: 'Turnover waived' }], // only the turnover finding, not the experience one
    });
    const row = content.complianceMatrix.find(r => r.bidderId === 'b2')!;
    expect(row.disqualified).toBe(true); // still disqualified — the experience finding was not overridden
    expect(content.rejectionGrounds.find(g => g.bidderId === 'b2')?.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Below 3-year requirement')])
    );
  });
});
