import pg from 'pg'

let _pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

export async function getFullBidText(tenantId: string, folderId: string): Promise<string> {
  const pool = getPool()
  const result = await pool.query<{ content: string }>(
    `SELECT content FROM document_chunks
     WHERE tenant_id = $1 AND person_folder_id = $2
     ORDER BY chunk_index ASC`,
    [tenantId, folderId],
  )
  return result.rows.map(r => r.content).join('\n\n')
}
