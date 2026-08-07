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
