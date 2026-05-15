import { neon } from '@neondatabase/serverless';
import { embedQuery } from './embeddings';

export interface RetrievedChunk {
  id: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  documentName: string;
  documentId: string;
  score: number;
}

interface SearchRow {
  id: string;
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown> | null;
  document_name: string;
  document_id: string;
  vector_score: number;
  text_score: number;
}

export async function retrieveChunks(
  query: string,
  tenantId: string,
  limit = 5,
  scoreThreshold = 0.5
): Promise<RetrievedChunk[]> {
  const sql = neon(process.env.DATABASE_URL!);

  // Embed the query
  const queryEmbedding = await embedQuery(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // Hybrid search — over-fetch 20 for RRF
  const rows = await sql`
    SELECT
      dc.id,
      dc.content,
      dc.chunk_index,
      dc.metadata,
      d.name AS document_name,
      d.id   AS document_id,
      (1 - (dc.embedding <=> ${vectorStr}::vector))                    AS vector_score,
      ts_rank(dc.tsv, websearch_to_tsquery('english', ${query}))        AS text_score
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.tenant_id = ${tenantId}
      AND d.status = 'ready'
      AND (
        dc.embedding <=> ${vectorStr}::vector < 0.7
        OR dc.tsv @@ websearch_to_tsquery('english', ${query})
      )
    LIMIT 20
  ` as unknown as SearchRow[];

  if (rows.length === 0) return [];

  // Separate vector and text ranked lists
  const byVector = [...rows].sort((a, b) => b.vector_score - a.vector_score);
  const byText   = [...rows].sort((a, b) => b.text_score - a.text_score);

  // RRF merge
  const rrfScores = new Map<string, number>();
  const k = 60;
  [byVector, byText].forEach(list => {
    list.forEach((row, index) => {
      const current = rrfScores.get(row.id) ?? 0;
      rrfScores.set(row.id, current + 1 / (k + index + 1));
    });
  });

  // Build result map
  const rowMap = new Map(rows.map(r => [r.id, r]));

  return Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .filter(([, score]) => score >= scoreThreshold / 100) // RRF scores are small decimals
    .map(([id, score]) => {
      const row = rowMap.get(id)!;
      return {
        id,
        content: row.content,
        chunkIndex: row.chunk_index,
        metadata: row.metadata ?? {},
        documentName: row.document_name,
        documentId: row.document_id,
        score,
      };
    });
}
