import { RetrievedChunk } from './retrieve';

export function formatContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  const lines: string[] = [
    '[KNOWLEDGE BASE CONTEXT]',
    'The following is retrieved from the tenant\'s private documents.',
    'Always cite the source document name when using this information.',
    '',
  ];

  chunks.forEach((chunk, i) => {
    const relevance = (chunk.score * 100).toFixed(0);
    lines.push(`[${i + 1}] Source: ${chunk.documentName} (relevance: ${relevance}%)`);
    lines.push(chunk.content);
    lines.push('');
  });

  lines.push('If the answer is not found above, say so clearly.');
  return lines.join('\n');
}

export function shouldInjectContext(chunks: RetrievedChunk[], _minScore = 0.5): boolean {
  if (chunks.length === 0) return false;
  // RRF scores are small decimals — top score > 0.008 is roughly equivalent to relevance > 0.5
  // Adjust threshold based on observed scores in your data
  return chunks[0].score > 0.008;
}
