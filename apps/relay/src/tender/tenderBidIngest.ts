import * as crypto from 'crypto'
import pg from 'pg'
import { embedStep } from '../mastra/workflows/ingestionWorkflow.embed.js'

let _pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// Matches the formula in pqEvaluate / technicalEvaluate / financialEvaluate
function bidderFolderId(tenantId: string, tenderId: string, displayLabel: string): string {
  const stem = displayLabel.toLowerCase().replace(/\s+/g, '-')
  const h = crypto.createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function docFileId(tenantId: string, folderId: string, filename: string): string {
  const h = crypto.createHash('sha256').update(`${tenantId}:${folderId}:${filename}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

async function ensureFolder(tenantId: string, folderId: string, identifier: string): Promise<void> {
  const pool = getPool()
  await pool.query(`
    INSERT INTO person_folders (id, tenant_id, identifier, display_name, status)
    VALUES ($1, $2, $3, $4, 'ingested')
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ingested'
  `, [folderId, tenantId, identifier, identifier])
}

async function extractText(name: string, mimeType: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase()
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: buf })
    return (result.value ?? '').trim()
  }
  // PDF (default)
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const result = await parser.getText()
  return (result.text ?? '').trim()
}

export async function ingestBidFromBase64(params: {
  tenderId: string
  tenantId: string
  displayLabel: string
  files: Array<{ name: string; mimeType: string; dataBase64: string }>
}): Promise<void> {
  const { tenderId, tenantId, displayLabel, files } = params
  const folderId = bidderFolderId(tenantId, tenderId, displayLabel)
  const stem = displayLabel.toLowerCase().replace(/\s+/g, '-')
  await ensureFolder(tenantId, folderId, `tender:${tenderId}:${stem}`)

  for (const file of files) {
    try {
      const buf = Buffer.from(file.dataBase64, 'base64')
      const text = await extractText(file.name, file.mimeType, buf)
      if (!text) { console.warn(`[bidIngest] no text extracted from ${file.name}`); continue }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (embedStep as any).execute({
        inputData: {
          fileId: docFileId(tenantId, folderId, file.name),
          filename: file.name,
          mimeType: file.mimeType,
          bufferBase64: '',
          extractedText: text,
          tenantId,
          personFolderId: folderId,
          formatDetected: file.mimeType.includes('pdf') ? 'pdf' : 'docx',
          isScanned: false,
          documentType: 'procurement_document',
          classificationConfidence: 1,
          classificationReasoning: 'bid document — officer upload',
          extractedFields: [],
          overallQuality: 'high',
          needsReview: false,
          validationIssues: [],
        },
      })
      console.log(`[bidIngest] ${displayLabel} / ${file.name} → folderId=${folderId}`)
    } catch (err) {
      console.error(`[bidIngest] failed ${file.name}: ${(err as Error).message}`)
    }
  }
}
