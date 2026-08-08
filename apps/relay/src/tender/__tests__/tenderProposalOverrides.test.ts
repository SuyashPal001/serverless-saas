import { describe, it, expect } from 'vitest';
import { latestPqOverrides, type OfficerActionRow } from '../tenderProposalOverrides.js';

function row(overrides: Partial<OfficerActionRow>): OfficerActionRow {
  return { findingId: 'pq1', action: 'override', rationale: null, createdAt: new Date('2026-08-01T00:00:00Z'), ...overrides };
}

describe('latestPqOverrides', () => {
  it('includes a finding whose only action is override', () => {
    const result = latestPqOverrides([row({ findingId: 'pq1', action: 'override', rationale: 'Waived' })]);
    expect(result).toEqual([{ findingId: 'pq1', rationale: 'Waived' }]);
  });

  it('excludes a finding whose only action is accept or escalate', () => {
    expect(latestPqOverrides([row({ action: 'accept' })])).toHaveLength(0);
    expect(latestPqOverrides([row({ action: 'escalate' })])).toHaveLength(0);
  });

  it('lets a later escalate supersede an earlier override', () => {
    const result = latestPqOverrides([
      row({ findingId: 'pq1', action: 'override', createdAt: new Date('2026-08-01T00:00:00Z') }),
      row({ findingId: 'pq1', action: 'escalate', createdAt: new Date('2026-08-02T00:00:00Z') }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('lets a later override supersede an earlier accept', () => {
    const result = latestPqOverrides([
      row({ findingId: 'pq1', action: 'accept', createdAt: new Date('2026-08-01T00:00:00Z') }),
      row({ findingId: 'pq1', action: 'override', createdAt: new Date('2026-08-02T00:00:00Z'), rationale: 'Reconsidered' }),
    ]);
    expect(result).toEqual([{ findingId: 'pq1', rationale: 'Reconsidered' }]);
  });

  it('uses the most recent rationale when a finding has multiple override rows', () => {
    const result = latestPqOverrides([
      row({ findingId: 'pq1', action: 'override', createdAt: new Date('2026-08-01T00:00:00Z'), rationale: 'First reason' }),
      row({ findingId: 'pq1', action: 'override', createdAt: new Date('2026-08-03T00:00:00Z'), rationale: 'Corrected reason' }),
    ]);
    expect(result).toEqual([{ findingId: 'pq1', rationale: 'Corrected reason' }]);
  });

  it('handles multiple independent findings correctly', () => {
    const result = latestPqOverrides([
      row({ findingId: 'pq1', action: 'override' }),
      row({ findingId: 'pq2', action: 'accept' }),
      row({ findingId: 'pq3', action: 'override', rationale: 'Waived too' }),
    ]);
    expect(result.map(r => r.findingId).sort()).toEqual(['pq1', 'pq3']);
  });

  it('ignores rows with a null findingId', () => {
    expect(latestPqOverrides([row({ findingId: null })])).toHaveLength(0);
  });

  it('returns an empty array for no rows', () => {
    expect(latestPqOverrides([])).toEqual([]);
  });
});
