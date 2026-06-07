import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { db, tenderClauses, personFolders } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import pg from 'pg'

let _pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
import { embedStep } from '../mastra/workflows/ingestionWorkflow.embed.js'

const GATEWAY_URL = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001').trim()
const REPO_ROOT = path.resolve(process.cwd(), '../..')

export interface IngestSummary {
  rfpIngested: boolean
  rfpFileId: string
  bidderMap: Record<string, string>  // filename stem → bidder display label
  clauseCount: number
  errors: string[]
}

function resolveInputDir(): string {
  const raw = (process.env.TENDER_INPUT_DIR ?? 'scratch/tender-samples/').trim()
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw)
}

async function pdfText(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath)
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const result = await parser.getText() as { text?: string }
  return result.text ?? ''
}

// Returns text with [PAGE N] markers so the model can report sourcePage per clause.
async function pdfTextByPage(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath)
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const result = await parser.getText({ pageJoiner: '[PAGE page_number]' }) as { text?: string }
  return result.text ?? ''
}

function fileId(seed: string): string {
  const h = crypto.createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}

async function ensureFolder(tenantId: string, folderId: string, identifier: string): Promise<void> {
  // Upsert by raw SQL to use the deterministic UUID as the PK
  const pool = getPool()
  await pool.query(`
    INSERT INTO person_folders (id, tenant_id, identifier, display_name, status)
    VALUES ($1, $2, $3, $4, 'ingested')
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ingested'
  `, [folderId, tenantId, identifier, identifier])
}

async function runIngest(params: {
  filePath: string
  tenantId: string
  personFolderId: string
  label: string
  identifier: string
}): Promise<void> {
  const { filePath, tenantId, personFolderId, label, identifier } = params
  const filename = path.basename(filePath)
  const text = await pdfText(filePath)
  if (!text.trim()) throw new Error(`No text extracted from ${filename}`)

  // Ensure person_folders row exists (FK required by document_chunks)
  await ensureFolder(tenantId, personFolderId, identifier)

  // Call embedStep directly — we have the text, no need for classify/validate (those need MASTRA_MODEL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (embedStep as any).execute({
    inputData: {
      fileId: fileId(`${tenantId}:${personFolderId}:${filename}`),
      filename,
      mimeType: 'application/pdf',
      bufferBase64: '',
      extractedText: text,
      tenantId,
      personFolderId,
      formatDetected: 'pdf',
      isScanned: false,
      documentType: 'procurement_document',
      classificationConfidence: 1,
      classificationReasoning: 'tender document — text pre-extracted',
      extractedFields: [],
      overallQuality: 'high',
      needsReview: false,
      validationIssues: [],
    },
  })
  console.log(`[tenderIngest] ingested ${label} → personFolderId=${personFolderId}`)
}

async function extractAndSaveClauses(
  tenderId: string, tenantId: string, rfpPath: string
): Promise<number> {
  const model = (process.env.TENDER_MODEL ?? '').trim()
  if (!model) throw new Error('TENDER_MODEL env var is not set — cannot extract clauses')

  // Per-page text with [PAGE N] markers so the model can report sourcePage.
  const pageAnnotated = await pdfTextByPage(rfpPath)
  // Cap at ~12 000 chars to stay within model context; cover early pages where clauses live.
  const rfpSnippet = pageAnnotated.slice(0, 12000)

  const systemPrompt = `You are parsing a government RFP document to extract technical requirement clauses.
The text contains [PAGE N] markers indicating page boundaries.
Return ONLY valid JSON — no markdown, no explanation.
Format:
{"clauses":[{"clauseNo":"3.2","title":"Short title","content":"Full requirement text","category":"technical","sourcePage":5}]}

RULES:
- Only extract clauses explicitly present in the text — never invent or infer.
- sourcePage must be the integer page number (from the nearest preceding [PAGE N] marker) where the clause appears; null if not determinable.
- If no recognizable requirement clauses are found, return {"clauses":[],"noClausesReason":"<short reason>"}.`

  const userPrompt = `Extract all technical requirement clauses from this RFP text.
Include clauses stating specific technical, operational, or compliance requirements.
Exclude pure administrative/legal boilerplate.

RFP TEXT:
${rfpSnippet}`

  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Model returned ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const raw = (data.choices?.[0]?.message?.content ?? '').trim()
  if (!raw) throw new Error('Model returned empty content for clause extraction')
  const content = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  const parsed = JSON.parse(content) as {
    clauses?: Array<{ clauseNo: string; title: string; content: string; category?: string; sourcePage?: number | null }>
    noClausesReason?: string
  }

  const items = parsed.clauses ?? []
  if (items.length === 0) {
    const reason = parsed.noClausesReason ?? 'model extracted 0 clauses'
    throw new Error(`No clauses extracted — ${reason}`)
  }

  await db.delete(tenderClauses).where(
    and(eq(tenderClauses.tenderId, tenderId), eq(tenderClauses.tenantId, tenantId))
  )

  await db.insert(tenderClauses).values(
    items.map(c => ({
      tenderId,
      tenantId,
      clauseNo:   c.clauseNo ?? '?',
      title:      c.title ?? c.clauseNo ?? '?',
      content:    c.content ?? '',
      category:   c.category ?? 'technical',
      sourcePage: typeof c.sourcePage === 'number' ? c.sourcePage : null,
    }))
  )

  console.log(`[tenderIngest] saved ${items.length} clauses for tenderId=${tenderId}`)
  return items.length
}

export async function ingestTenderDocs(
  tenderId: string,
  tenantId: string,
): Promise<IngestSummary> {
  const inputDir = resolveInputDir()
  const errors: string[] = []

  if (!fs.existsSync(inputDir)) {
    throw new Error(
      `TENDER_INPUT_DIR does not exist: ${inputDir}\n` +
      `Create it and place rfp.pdf + bidder-N.pdf files there.`
    )
  }

  const allFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.pdf'))
  if (allFiles.length === 0) {
    throw new Error(
      `No PDF files found in ${inputDir}.\n` +
      `Add rfp.pdf (the RFP document) and bidder-1.pdf, bidder-2.pdf, … (one per bidder).`
    )
  }

  const rfpFile = allFiles.find(f => f.toLowerCase() === 'rfp.pdf')
  if (!rfpFile) {
    throw new Error(
      `rfp.pdf not found in ${inputDir}.\n` +
      `The RFP document must be named exactly rfp.pdf.`
    )
  }

  const bidderFiles = allFiles.filter(f => /^bidder-/i.test(f))
  const rfpPath = path.join(inputDir, rfpFile)
  const rfpFolderId = tenderId  // RFP chunks scoped to tenderId
  const rfpFileIdVal = fileId(`${tenantId}:rfp:${tenderId}`)

  // Ingest RFP
  try {
    await runIngest({ filePath: rfpPath, tenantId, personFolderId: rfpFolderId, label: 'rfp', identifier: `tender:${tenderId}:rfp` })
  } catch (err) {
    throw new Error(`RFP ingestion failed: ${(err as Error).message}`)
  }

  // Extract clauses from RFP with page provenance
  let clauseCount = 0
  try {
    clauseCount = await extractAndSaveClauses(tenderId, tenantId, rfpPath)
  } catch (err) {
    throw new Error(`Clause extraction failed: ${(err as Error).message}`)
  }

  // Ingest bidder documents — use filename stem as display label
  const bidderMap: Record<string, string> = {}
  for (const bf of bidderFiles) {
    const stem = bf.replace(/\.pdf$/i, '')
    const bFolderId = fileId(`${tenantId}:bidder:${tenderId}:${stem}`)
    try {
      await runIngest({
        filePath: path.join(inputDir, bf),
        tenantId,
        personFolderId: bFolderId,
        label: stem,
        identifier: `tender:${tenderId}:${stem}`,
      })
      bidderMap[stem] = bFolderId
    } catch (err) {
      const msg = `Bidder ingest failed for ${bf}: ${(err as Error).message}`
      console.error(`[tenderIngest] ${msg}`)
      errors.push(msg)
    }
  }

  return {
    rfpIngested: true,
    rfpFileId: rfpFileIdVal,
    bidderMap,
    clauseCount,
    errors,
  }
}
