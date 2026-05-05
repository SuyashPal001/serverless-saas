import { rewriteQuery } from './queryRewrite.js';
import { gateChunks, ScoredChunk } from './relevanceGate.js';

export interface RAGResult {
  context: string | null;
  skipped: boolean;
  reason?: string;
}

export async function runRAGPipeline(
  message: string,
  history: { role: string; content: string }[],
  tenantId: string,
  fetchChunks: (query: string, tenantId: string) => Promise<ScoredChunk[]>
): Promise<RAGResult> {
  try {
    const rewritten = await rewriteQuery(message, history);
    console.log(`[RAG] Query: "${message}" → "${rewritten}"`);

    const chunks = await fetchChunks(rewritten, tenantId);
    if (chunks.length === 0) {
      return { context: null, skipped: true, reason: 'no chunks retrieved' };
    }

    const gated = await gateChunks(rewritten, chunks);
    if (gated.length === 0) {
      console.log('[RAG] All chunks failed relevance gate — skipping');
      return { context: null, skipped: true, reason: 'relevance gate filtered all chunks' };
    }

    const context = gated.slice(0, 3).map((c: ScoredChunk, i: number) =>
      `[${i + 1}] Source: ${c.document_name} (relevance: ${c.relevanceScore}/3)\n${c.content}`
    ).join('\n\n');

    return {
      context: `[KNOWLEDGE BASE CONTEXT]\nThe following is retrieved from the tenant's private documents. Cite the source document inline using [1], [2], etc.\n\n${context}\n\nIf the answer is not found above, say so clearly — do not invent information.`,
      skipped: false
    };
  } catch (err) {
    console.error('[RAG] Pipeline error:', err);
    return { context: null, skipped: true, reason: 'pipeline error' };
  }
}

export type { ScoredChunk };
