import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from '../clauseSearchQuery.js';

describe('escapeLikePattern', () => {
  it('wraps a single-word query in a case-insensitive ILIKE wildcard pattern', () => {
    expect(escapeLikePattern('EMD')).toBe('%EMD%');
  });

  it('trims surrounding whitespace from the query before building the pattern', () => {
    expect(escapeLikePattern('  Integrity Pact  ')).toBe('%Integrity Pact%');
  });

  it('escapes SQL LIKE wildcard characters in the query itself so they are treated literally', () => {
    // A clause code like "CL-001%" or a query containing literal % or _ must not
    // be interpreted as a wildcard — otherwise "50%" would match everything.
    expect(escapeLikePattern('50% completion')).toBe('%50\\% completion%');
  });

  it('produces a non-empty pattern even for very short queries (no minimum-length gate at this layer)', () => {
    expect(escapeLikePattern('MSE')).toBe('%MSE%');
  });
});
