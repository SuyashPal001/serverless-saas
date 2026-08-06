import { describe, it, expect } from 'vitest';
import { buildClauseSearchQuery } from '../searchClauseLibrary.js';

describe('buildClauseSearchQuery', () => {
  it('builds a case-insensitive ILIKE pattern across title, content, and tags for a single-word query', () => {
    const { whereClause, params } = buildClauseSearchQuery('EMD');
    expect(whereClause).toContain('ILIKE');
    expect(params).toEqual(['%EMD%']);
  });

  it('trims surrounding whitespace from the query before building the pattern', () => {
    const { params } = buildClauseSearchQuery('  Integrity Pact  ');
    expect(params).toEqual(['%Integrity Pact%']);
  });

  it('escapes SQL LIKE wildcard characters in the query itself so they are treated literally', () => {
    // A clause code like "CL-001%" or a query containing literal % or _ must not
    // be interpreted as a wildcard — otherwise "50%" would match everything.
    const { params } = buildClauseSearchQuery('50% completion');
    expect(params[0]).toBe('%50\\% completion%');
  });

  it('produces a non-empty pattern even for very short queries (no minimum-length gate at this layer)', () => {
    const { params } = buildClauseSearchQuery('MSE');
    expect(params[0]).toBe('%MSE%');
  });
});
