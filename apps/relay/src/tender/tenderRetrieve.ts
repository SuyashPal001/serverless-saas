import pg from 'pg'

const GATEWAY_URL = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001').trim()

let _pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-004', input: text }),
    })
    if (!res.ok) return null
    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]?.embedding ?? null
  } catch {
    return null
  }
}

export interface TenderChunk {
  content: string
  documentName: string
  chunkIndex: number
  score: number
}

export async function retrieveTenderChunks(
  query: string,
  tenantId: string,
  folderId: string,
  limit = 5,
  threshold = 0.3,
): Promise<TenderChunk[]> {
  const embedding = await embedQuery(query)
  if (!embedding) return []

  const vectorStr = `[${embedding.join(',')}]`
  const pool = getPool()

  const result = await pool.query<{
    content: string; document_name: string; chunk_index: number;
    vector_score: number; text_score: number
  }>(`
    SELECT
      dc.content,
      COALESCE(dc.metadata->>'filename', 'document') AS document_name,
      dc.chunk_index,
      (1 - (dc.embedding <=> $1::vector)) AS vector_score,
      ts_rank(dc.tsv, websearch_to_tsquery('english', $2)) AS text_score
    FROM document_chunks dc
    WHERE dc.tenant_id = $3
      AND dc.person_folder_id = $4
      AND dc.embedding IS NOT NULL
      AND (
        dc.embedding <=> $1::vector < 0.7
        OR dc.tsv @@ websearch_to_tsquery('english', $2)
      )
    ORDER BY vector_score DESC
    LIMIT $5
  `, [vectorStr, query, tenantId, folderId, limit * 2])

  return result.rows
    .map(r => ({
      content: r.content,
      documentName: r.document_name,
      chunkIndex: r.chunk_index,
      score: r.vector_score,
    }))
    .filter(r => r.score >= threshold)
    .slice(0, limit)
}
