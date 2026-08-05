import { describe, it, expect } from 'vitest';
import { evaluateStructuralChecks, type SectionState } from '../tenderDocumentCheckRules.js';

function sections(overrides: Partial<Record<string, Partial<SectionState>>> = {}): SectionState[] {
  const all: SectionState[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((sectionNo) => ({
    sectionNo, present: true, accepted: true, hasContent: true,
    ...(overrides[sectionNo] ?? {}),
  }));
  return all;
}

describe('evaluateStructuralChecks', () => {
  it('passes every section when all 8 are present, accepted, and non-empty', () => {
    const results = evaluateStructuralChecks(sections());
    expect(results).toHaveLength(8);
    expect(results.every(r => r.status === 'pass')).toBe(true);
  });

  it('fails a missing section', () => {
    const results = evaluateStructuralChecks(sections({ S6: { present: false, accepted: false, hasContent: false } }));
    const s6 = results.find(r => r.sectionNo === 'S6')!;
    expect(s6.status).toBe('fail');
    expect(s6.message).toContain('missing');
  });

  it('fails a present-but-unaccepted section', () => {
    const results = evaluateStructuralChecks(sections({ S3: { accepted: false } }));
    const s3 = results.find(r => r.sectionNo === 'S3')!;
    expect(s3.status).toBe('fail');
    expect(s3.message).toContain('not accepted');
  });

  it('fails a present-and-accepted-but-empty section', () => {
    const results = evaluateStructuralChecks(sections({ S8: { hasContent: false } }));
    const s8 = results.find(r => r.sectionNo === 'S8')!;
    expect(s8.status).toBe('fail');
    expect(s8.message).toContain('empty');
  });

  it('assigns a stable rule id per section', () => {
    const results = evaluateStructuralChecks(sections());
    expect(results.find(r => r.sectionNo === 'S1')!.ruleId).toBe('DC-S1');
  });
});
