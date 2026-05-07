/**
 * One-off backfill: populate tsv for document_chunks where tsv IS NULL.
 *
 * Safe to run multiple times — WHERE tsv IS NULL is idempotent.
 *
 * Usage:
 *   DATABASE_URL=<neon-connection-string> pnpm backfill:tsv
 */

import { neon } from '@neondatabase/serverless';

const BATCH_SIZE = 100;

interface ChunkRow {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // Count total chunks needing backfill
  const countResult = await sql`
    SELECT COUNT(*)::int AS total
    FROM document_chunks
    WHERE tsv IS NULL
  ` as unknown as Array<{ total: number }>;

  const total = countResult[0]?.total ?? 0;

  if (total === 0) {
    console.log('No chunks need backfill — tsv is already populated for all chunks.');
    return;
  }

  console.log(`Backfilling tsv for ${total} chunks in batches of ${BATCH_SIZE}...`);

  let processed = 0;

  while (processed < total) {
    const rows = await sql`
      SELECT id, content, metadata
      FROM document_chunks
      WHERE tsv IS NULL
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
    ` as unknown as ChunkRow[];

    if (rows.length === 0) break;

    for (const row of rows) {
      const questions = Array.isArray(
        (row.metadata as Record<string, unknown> | null)?.questions
      )
        ? ((row.metadata as Record<string, unknown>).questions as string[]).join(' ')
        : '';

      const tsvSource = questions
        ? `${row.content} ${questions}`
        : row.content;

      await sql`
        UPDATE document_chunks
        SET tsv = to_tsvector('english', ${tsvSource})
        WHERE id = ${row.id}
          AND tsv IS NULL
      `;
    }

    processed += rows.length;
    console.log(`Backfilled ${processed} / ${total} chunks`);
  }

  console.log(`Done. Backfilled ${processed} chunks total.`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
