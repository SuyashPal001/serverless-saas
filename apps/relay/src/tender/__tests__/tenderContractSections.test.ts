import { describe, it, expect } from 'vitest';
import { sectionText, type RfpSectionRow } from '../tenderContractSections.js';

function row(content: unknown): RfpSectionRow {
  return { sectionNo: 'S3', title: 'Scope of Work', content, acceptedAt: new Date('2026-08-01T00:00:00Z') };
}

describe('sectionText', () => {
  it('renders a section with only text', () => {
    expect(sectionText(row({ text: 'The Contractor shall deliver within 12 months.' })))
      .toBe('The Contractor shall deliver within 12 months.');
  });

  it('renders a section with only rows in readable key: value form, not raw JSON', () => {
    const result = sectionText(row({ rows: [{ metric: 'Uptime', target: '99.5%', measurement: 'Monthly' }] }));
    expect(result).toBe('metric: Uptime, target: 99.5%, measurement: Monthly');
    expect(result).not.toContain('{');
    expect(result).not.toContain('"');
  });

  it('renders multiple rows one per line', () => {
    const result = sectionText(row({ rows: [
      { metric: 'Uptime', target: '99.5%' },
      { metric: 'Response Time', target: '< 2s' },
    ] }));
    expect(result).toBe('metric: Uptime, target: 99.5%\nmetric: Response Time, target: < 2s');
  });

  it('renders a section with only clauses', () => {
    const result = sectionText(row({ clauses: [
      { clauseNo: '8.1', title: 'Confidentiality', text: 'The Contractor shall keep all data confidential.' },
      { clauseNo: '8.2', title: 'Termination', text: 'Either party may terminate with 30 days notice.' },
    ] }));
    expect(result).toBe(
      '8.1 Confidentiality: The Contractor shall keep all data confidential.\n' +
      '8.2 Termination: Either party may terminate with 30 days notice.'
    );
  });

  it('renders a section with rows AND clauses combined', () => {
    const result = sectionText(row({
      rows: [{ metric: 'Uptime', target: '99.5%' }],
      clauses: [{ clauseNo: '8.1', title: 'Confidentiality', text: 'Keep data confidential.' }],
    }));
    expect(result).toBe('metric: Uptime, target: 99.5%\n8.1 Confidentiality: Keep data confidential.');
  });

  it('returns an empty string when content is null', () => {
    expect(sectionText(row(null))).toBe('');
  });

  it('returns an empty string when content is an empty object', () => {
    expect(sectionText(row({}))).toBe('');
  });
});
