import { describe, it, expect, vi } from 'vitest';

// Mock all external dependencies that agents require
vi.mock('@serverless-saas/ai', () => ({
  retrieveChunks: vi.fn(),
}));

vi.mock('../../tools.js', () => ({
  getMCPClientForTenant: vi.fn(),
}));

vi.mock('../../memory.js', () => ({
  getMastraMemory: vi.fn(),
}));

vi.mock('../../guardrails.js', () => ({
  createViolationHandler: vi.fn(),
}));

// Mock the agents themselves as simple objects
vi.mock('../agents/platformAgent.js', () => ({
  platformAgent: { id: 'platform-agent', name: 'Platform' },
}));

vi.mock('../agents/pmAgent.js', () => ({
  pmAgent: { id: 'pm-agent', name: 'PM' },
}));

vi.mock('../agents/architectAgent.js', () => ({
  architectAgent: { id: 'architect-agent', name: 'Architect' },
}));

vi.mock('../agents/aiParasAgent.js', () => ({
  aiParasAgent: { id: 'aipara-agent', name: 'AI-PARAS' },
}));

vi.mock('../agents/tenderAdvisorAgent.js', () => ({
  tenderAdvisorAgent: { id: 'tender-advisor-agent', name: 'Tender Advisor' },
}));

import { resolveAgent, resolveAgentLabel } from '../registry.js';
import { tenderAdvisorAgent } from '../agents/tenderAdvisorAgent.js';
import { platformAgent } from '../agents/platformAgent.js';
import { pmAgent } from '../agents/pmAgent.js';
import { architectAgent } from '../agents/architectAgent.js';
import { aiParasAgent } from '../agents/aiParasAgent.js';

describe('resolveAgent — Procurement Advisor / Tender Advisor routing', () => {
  it('routes the exact DB-seeded name "Procurement Advisor" to tenderAdvisorAgent', () => {
    expect(resolveAgent('Procurement Advisor')).toBe(tenderAdvisorAgent);
  });

  it('routes case-insensitively', () => {
    expect(resolveAgent('procurement advisor')).toBe(tenderAdvisorAgent);
    expect(resolveAgent('PROCUREMENT ADVISOR')).toBe(tenderAdvisorAgent);
  });

  it('also routes "Tender Advisor" (the agent\'s own internal name) to the same agent', () => {
    expect(resolveAgent('Tender Advisor')).toBe(tenderAdvisorAgent);
  });

  it('resolveAgentLabel reports tenderAdvisorAgent by name, not the platformAgent fallback label', () => {
    expect(resolveAgentLabel(tenderAdvisorAgent as any)).toBe('tenderAdvisorAgent');
  });
});

describe('resolveAgent — existing routing is unchanged (regression guard)', () => {
  it('still routes saarthi, pm agent, architect, ai-paras, document intelligence correctly', () => {
    expect(resolveAgent('Saarthi')).toBe(platformAgent);
    expect(resolveAgent('PM Agent')).toBe(pmAgent);
    expect(resolveAgent('Architect')).toBe(architectAgent);
    expect(resolveAgent('AI-PARAS')).toBe(aiParasAgent);
    expect(resolveAgent('Document Intelligence')).toBe(aiParasAgent);
  });

  it('still defaults unknown names to platformAgent', () => {
    expect(resolveAgent('Some Unknown Agent Name')).toBe(platformAgent);
    expect(resolveAgent('')).toBe(platformAgent);
  });

  it('does not let "Procurement Advisor" accidentally match an unrelated existing key by substring', () => {
    // Sanity check: none of the pre-existing registry keys are substrings of
    // "procurement advisor" or vice versa, so the new entry can't collide.
    const result = resolveAgent('Procurement Advisor');
    expect(result).not.toBe(platformAgent);
    expect(result).not.toBe(pmAgent);
    expect(result).not.toBe(architectAgent);
    expect(result).not.toBe(aiParasAgent);
  });
});
