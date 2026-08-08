import { describe, it, expect } from 'vitest';
import { buildDefaultChainSteps, summarizeChain, canActOnStep, DEFAULT_APPROVAL_CHAIN, type ApprovalStepState } from '../tenderApprovalChain.js';

describe('buildDefaultChainSteps', () => {
  it('builds the default 2-level chain in order', () => {
    const steps = buildDefaultChainSteps();
    expect(steps).toEqual([
      { stepOrder: 1, approverRole: 'Reviewing Officer' },
      { stepOrder: 2, approverRole: 'Approving Authority' },
    ]);
  });

  it('accepts a custom role list and preserves its order', () => {
    const steps = buildDefaultChainSteps(['Desk Officer', 'Section Head', 'Director']);
    expect(steps.map(s => s.stepOrder)).toEqual([1, 2, 3]);
    expect(steps.map(s => s.approverRole)).toEqual(['Desk Officer', 'Section Head', 'Director']);
  });
});

function step(overrides: Partial<ApprovalStepState>): ApprovalStepState {
  return { stepOrder: 1, approverRole: 'Reviewing Officer', status: 'pending', ...overrides };
}

describe('summarizeChain', () => {
  it('identifies the current actionable step as the lowest-order pending step', () => {
    const summary = summarizeChain([
      step({ stepOrder: 1, status: 'approved' }),
      step({ stepOrder: 2, approverRole: 'Approving Authority', status: 'pending' }),
    ]);
    expect(summary.currentStep?.stepOrder).toBe(2);
    expect(summary.isFullyApproved).toBe(false);
    expect(summary.isRejected).toBe(false);
    expect(summary.completedCount).toBe(1);
    expect(summary.totalCount).toBe(2);
  });

  it('reports isFullyApproved when every step is approved, with no current step', () => {
    const summary = summarizeChain([
      step({ stepOrder: 1, status: 'approved' }),
      step({ stepOrder: 2, status: 'approved' }),
    ]);
    expect(summary.isFullyApproved).toBe(true);
    expect(summary.currentStep).toBeNull();
    expect(summary.completedCount).toBe(2);
  });

  it('reports isRejected when any step is rejected, with no current step (chain halted)', () => {
    const summary = summarizeChain([
      step({ stepOrder: 1, status: 'approved' }),
      step({ stepOrder: 2, status: 'rejected' }),
    ]);
    expect(summary.isRejected).toBe(true);
    expect(summary.currentStep).toBeNull();
    expect(summary.isFullyApproved).toBe(false);
  });

  it('handles a single-step chain not yet acted on', () => {
    const summary = summarizeChain([step({ stepOrder: 1, status: 'pending' })]);
    expect(summary.currentStep?.stepOrder).toBe(1);
    expect(summary.completedCount).toBe(0);
  });
});

describe('canActOnStep', () => {
  const chain: ApprovalStepState[] = [
    step({ stepOrder: 1, approverRole: 'Reviewing Officer', status: 'approved' }),
    step({ stepOrder: 2, approverRole: 'Approving Authority', status: 'pending' }),
  ];

  it('allows acting on the current pending step', () => {
    expect(canActOnStep(chain, 2)).toBe(true);
  });

  it('rejects acting on an already-approved step', () => {
    expect(canActOnStep(chain, 1)).toBe(false);
  });

  it('rejects acting out of order — a later step cannot be actioned before an earlier pending one', () => {
    const outOfOrder: ApprovalStepState[] = [
      step({ stepOrder: 1, status: 'pending' }),
      step({ stepOrder: 2, status: 'pending' }),
    ];
    expect(canActOnStep(outOfOrder, 2)).toBe(false);
    expect(canActOnStep(outOfOrder, 1)).toBe(true);
  });

  it('rejects acting on any step once the chain is halted by a rejection', () => {
    const halted: ApprovalStepState[] = [
      step({ stepOrder: 1, status: 'rejected' }),
      step({ stepOrder: 2, status: 'pending' }),
    ];
    expect(canActOnStep(halted, 2)).toBe(false);
    expect(canActOnStep(halted, 1)).toBe(false);
  });

  it('returns false for a stepOrder that does not exist in the chain', () => {
    expect(canActOnStep(chain, 99)).toBe(false);
  });
});
