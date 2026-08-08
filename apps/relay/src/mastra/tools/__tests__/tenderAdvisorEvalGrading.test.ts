import { describe, it, expect } from 'vitest';
import { gradeAnswer } from '../../../../scripts/tenderAdvisorEval.js';

describe('gradeAnswer', () => {
  it('passes when all expected keywords appear (case-insensitive)', () => {
    const result = gradeAnswer('The bidder InfraVision Technologies is L1 at ₹7.82 Cr.', ['InfraVision', '7.82']);
    expect(result.pass).toBe(true);
    expect(result.matchedCount).toBe(2);
    expect(result.totalKeywords).toBe(2);
  });

  it('fails when some expected keywords are missing', () => {
    const result = gradeAnswer('The lowest bidder is TechAxis.', ['InfraVision', '7.82']);
    expect(result.pass).toBe(false);
    expect(result.matchedCount).toBe(0);
  });

  it('is case-insensitive', () => {
    const result = gradeAnswer('the WINNER is infravision', ['InfraVision']);
    expect(result.pass).toBe(true);
  });

  it('matches partial keyword sets and reports the count accurately', () => {
    const result = gradeAnswer('I cannot recommend a specific bidder for this award.', ['cannot recommend', 'competent authority']);
    expect(result.pass).toBe(false);
    expect(result.matchedCount).toBe(1);
    expect(result.totalKeywords).toBe(2);
  });

  it('handles an empty expectedKeywords array as an automatic pass (nothing to check)', () => {
    const result = gradeAnswer('Any answer at all.', []);
    expect(result.pass).toBe(true);
    expect(result.totalKeywords).toBe(0);
  });
});
