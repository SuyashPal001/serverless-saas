import { describe, it, expect } from 'vitest';
import { evaluatePublishGate } from '../tenderPublishGate.js';

describe('evaluatePublishGate', () => {
  it('blocks when any check has failed and no override is given', () => {
    const result = evaluatePublishGate(
      [{ status: 'pass' }, { status: 'fail' }],
      false
    );
    expect(result.blocked).toBe(true);
  });

  it('allows when all checks pass', () => {
    const result = evaluatePublishGate([{ status: 'pass' }, { status: 'flagged' }], false);
    expect(result.blocked).toBe(false);
  });

  it('allows when checks have failed but override is true', () => {
    const result = evaluatePublishGate([{ status: 'fail' }], true);
    expect(result.blocked).toBe(false);
    expect(result.overridden).toBe(true);
  });

  it('allows when no checks have been run at all (nothing to gate on)', () => {
    const result = evaluatePublishGate([], false);
    expect(result.blocked).toBe(false);
  });

  it('overridden is false when override was not needed (no failures)', () => {
    const result = evaluatePublishGate([{ status: 'pass' }], true);
    expect(result.overridden).toBe(false);
  });
});
