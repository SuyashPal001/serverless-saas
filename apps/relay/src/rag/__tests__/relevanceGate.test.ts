import { describe, it, expect, vi } from 'vitest'

// Must be declared before importing relevanceGate — vitest hoists vi.mock calls.
// quickGeminiCall is only used in gateChunks (LLM path); fastGateChunks is pure.
vi.mock('../../llm/quickCall.js', () => ({
  quickGeminiCall: vi.fn(),
}))

import { fastGateChunks } from '../relevanceGate.js'
import type { ScoredChunk } from '../relevanceGate.js'

function chunk(id: string, score: number): ScoredChunk {
  return { id, content: 'some content', document_name: 'doc.pdf', score }
}

describe('fastGateChunks', () => {
  it('returns chunks sorted by score descending, filtered by threshold', () => {
    const chunks = [chunk('a', 0.9), chunk('b', 0.6), chunk('c', 0.3)]
    // a and b are above 0.5; c is below but i=2 < 3 so the top-3 guard keeps it
    const result = fastGateChunks(chunks, 0.5, 5)
    expect(result.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('always keeps the top 3 by score even when all scores are below threshold', () => {
    const chunks = [chunk('a', 0.1), chunk('b', 0.2), chunk('c', 0.3), chunk('d', 0.4)]
    // Sorted: d, c, b, a — all below 0.5. Indices 0,1,2 (d,c,b) kept by `|| i < 3`.
    // Index 3 (a) dropped.
    const result = fastGateChunks(chunks, 0.5, 5)
    expect(result).toHaveLength(3)
    expect(result.map(r => r.id)).toEqual(['d', 'c', 'b'])
  })

  it('sets relevanceScore to 2 on every returned chunk', () => {
    const chunks = [chunk('x', 0.8), chunk('y', 0.7)]
    const result = fastGateChunks(chunks, 0.5, 5)
    for (const c of result) {
      expect(c.relevanceScore).toBe(2)
    }
  })

  it('honours the limit parameter', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(`c${i}`, 0.9))
    expect(fastGateChunks(chunks, 0.5, 4)).toHaveLength(4)
  })
})
