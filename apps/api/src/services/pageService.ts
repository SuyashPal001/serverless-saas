import { createHash, randomUUID } from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import pg from 'pg'
import { stripHtml } from '../utils/stripHtml.js'
import { publishToQueue } from '../lib/sqs.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Page {
  id: string
  tenantId: string
  planId: string | null
  parentId: string | null
  ownedBy: string
  createdBy: string
  title: string
  descriptionHtml: string
  descriptionJson: Record<string, unknown>
  descriptionStripped: string | null
  pageType: string
  source: string
  access: number
  isLocked: boolean
  archivedAt: string | null
  sortOrder: number
  documentId: string | null
  createdAt: string
  updatedAt: string
}

export interface PageVersion {
  id: string
  tenantId: string
  pageId: string
  ownedBy: string
  descriptionHtml: string
  descriptionJson: Record<string, unknown>
  descriptionStripped: string | null
  lastSavedAt: string
  createdAt: string
}

export interface CreatePageData {
  title?: string
  pageType?: string
  parentId?: string
  access?: number
}

export interface SavePageData {
  title?: string
  descriptionHtml?: string
  descriptionJson?: Record<string, unknown>
}

// ─── Pool singleton ───────────────────────────────────────────────────────────

let _pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    _pool.on('error', (err) => {
      console.error('[pageService] pool error:', err.message)
    })
  }
  return _pool
}

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' })

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToPage(r: Record<string, unknown>): Page {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    planId: r.plan_id as string | null,
    parentId: r.parent_id as string | null,
    ownedBy: r.owned_by as string,
    createdBy: r.created_by as string,
    title: r.title as string,
    descriptionHtml: r.description_html as string,
    descriptionJson: (r.description_json ?? {}) as Record<string, unknown>,
    descriptionStripped: r.description_stripped as string | null,
    pageType: r.page_type as string,
    source: r.source as string,
    access: r.access as number,
    isLocked: r.is_locked as boolean,
    archivedAt: r.archived_at as string | null,
    sortOrder: r.sort_order as number,
    documentId: r.document_id as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function rowToVersion(r: Record<string, unknown>): PageVersion {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    pageId: r.page_id as string,
    ownedBy: r.owned_by as string,
    descriptionHtml: r.description_html as string,
    descriptionJson: (r.description_json ?? {}) as Record<string, unknown>,
    descriptionStripped: r.description_stripped as string | null,
    lastSavedAt: r.last_saved_at as string,
    createdAt: r.created_at as string,
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function pageDocHash(pageId: string): string {
  return createHash('sha256').update(`wiki_page:${pageId}`).digest('hex')
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createPage(
  tenantId: string,
  userId: string,
  planId: string,
  data: CreatePageData,
): Promise<Page> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `INSERT INTO project_pages
       (id, tenant_id, plan_id, parent_id, owned_by, created_by, title, page_type, access)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
     RETURNING *`,
    [
      randomUUID(), tenantId, planId,
      data.parentId ?? null, userId,
      data.title ?? 'Untitled', data.pageType ?? 'custom', data.access ?? 0,
    ],
  )
  return rowToPage(rows[0])
}

export async function listPages(tenantId: string, planId: string): Promise<Page[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT * FROM project_pages
     WHERE tenant_id = $1 AND plan_id = $2 AND archived_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
    [tenantId, planId],
  )
  return rows.map(rowToPage)
}

export async function getPage(tenantId: string, pageId: string): Promise<Page | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT * FROM project_pages
     WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`,
    [tenantId, pageId],
  )
  return rows.length ? rowToPage(rows[0]) : null
}

export async function savePage(
  tenantId: string,
  userId: string,
  pageId: string,
  data: SavePageData,
): Promise<Page> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const html = data.descriptionHtml ?? '<p></p>'
    const stripped = stripHtml(html)
    const json = data.descriptionJson ?? {}

    // 1. UPDATE project_pages
    const { rows: pageRows } = await client.query<Record<string, unknown>>(
      `UPDATE project_pages SET
         title              = COALESCE($3, title),
         description_html   = $4,
         description_json   = $5::jsonb,
         description_stripped = $6,
         updated_at         = NOW()
       WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
       RETURNING *`,
      [tenantId, pageId, data.title ?? null, html, JSON.stringify(json), stripped],
    )
    if (!pageRows.length) throw new Error('Page not found or archived')
    const pageRow = pageRows[0]

    // 2. INSERT version snapshot
    await client.query(
      `INSERT INTO project_page_versions
         (id, tenant_id, page_id, owned_by,
          description_html, description_json, description_stripped, last_saved_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())`,
      [randomUUID(), tenantId, pageId, userId, html, JSON.stringify(json), stripped],
    )

    // 3. DELETE versions with rank > 20 (window function, single query)
    await client.query(
      `DELETE FROM project_page_versions
       WHERE id IN (
         SELECT id FROM (
           SELECT id,
             ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY last_saved_at DESC) AS rn
           FROM project_page_versions WHERE page_id = $1
         ) ranked WHERE rn > 20
       )`,
      [pageId],
    )

    // 4. Upload stripped text to S3 so worker can ingest it (text/plain pipeline)
    const s3FileKey = `tenants/${tenantId}/pages/${pageId}.txt`
    await s3.send(new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET!,
      Key: s3FileKey,
      Body: stripped,
      ContentType: 'text/plain',
    }))

    // 5. Upsert documents record for RAG — includes file_key + mime_type for worker
    const hash = pageDocHash(pageId)
    const planId = pageRow.plan_id as string | null
    const { rows: docRows } = await client.query<{ id: string }>(
      `INSERT INTO documents
         (id, tenant_id, uploaded_by, name, status, hash, file_key, mime_type, metadata)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'text/plain', $7::jsonb)
       ON CONFLICT (tenant_id, hash) DO UPDATE SET
         name       = EXCLUDED.name,
         status     = 'pending',
         file_key   = EXCLUDED.file_key,
         metadata   = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id`,
      [
        randomUUID(), tenantId, userId,
        (pageRow.title as string) ?? 'Untitled',
        hash, s3FileKey,
        JSON.stringify({ sourceType: 'wiki_page', pageId, planId, tenantId }),
      ],
    )

    // 6. UPDATE project_pages.document_id
    const docId = docRows[0].id
    await client.query(
      `UPDATE project_pages SET document_id = $1 WHERE id = $2`,
      [docId, pageId],
    )
    pageRow.document_id = docId

    await client.query('COMMIT')

    // 7. Fire SQS after commit — fire-and-forget, never fails the save
    const queueUrl = process.env.SQS_PROCESSING_QUEUE_URL
    if (queueUrl) {
      publishToQueue(queueUrl, {
        type: 'document.ingest',
        payload: { tenantId, documentId: docId, fileKey: s3FileKey, mimeType: 'text/plain' },
      }).catch((err: Error) => console.error('[pageService] SQS fire failed:', err.message))
    }

    return rowToPage(pageRow)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function archivePage(tenantId: string, pageId: string): Promise<void> {
  await getPool().query(
    `UPDATE project_pages SET archived_at = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, pageId],
  )
}

export async function toggleLock(
  tenantId: string,
  _userId: string,
  pageId: string,
): Promise<Page> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `UPDATE project_pages
     SET is_locked = NOT is_locked, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING *`,
    [tenantId, pageId],
  )
  if (!rows.length) throw new Error('Page not found')
  return rowToPage(rows[0])
}

export async function listVersions(
  tenantId: string,
  pageId: string,
): Promise<PageVersion[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT * FROM project_page_versions
     WHERE tenant_id = $1 AND page_id = $2
     ORDER BY last_saved_at DESC
     LIMIT 20`,
    [tenantId, pageId],
  )
  return rows.map(rowToVersion)
}

export async function restoreVersion(
  tenantId: string,
  userId: string,
  pageId: string,
  versionId: string,
): Promise<Page> {
  const { rows: vRows } = await getPool().query<Record<string, unknown>>(
    `SELECT * FROM project_page_versions
     WHERE tenant_id = $1 AND id = $2 AND page_id = $3`,
    [tenantId, versionId, pageId],
  )
  if (!vRows.length) throw new Error('Version not found')
  const v = vRows[0]
  return savePage(tenantId, userId, pageId, {
    descriptionHtml: v.description_html as string,
    descriptionJson: (v.description_json ?? {}) as Record<string, unknown>,
  })
}
