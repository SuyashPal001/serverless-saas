import { Hono } from 'hono'

const GATEWAY_URL = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001').trim()
const GATEWAY_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

export const tenderExtractRoutes = new Hono()

async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const result = await parser.getText()
  return (result.text ?? '').trim()
}

async function extractDocxText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: buf })
  return (result.value ?? '').trim()
}

async function ocrWithGemini(buf: Buffer, mimeType: string): Promise<string> {
  const base64 = buf.toString('base64')
  const body = JSON.stringify({
    model: GATEWAY_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: 'Extract all text from this document. Return only the extracted text exactly as written, preserving paragraph structure. No commentary.' },
      ],
    }],
    max_tokens: 8192,
  })
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Gemini OCR returned ${res.status}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

async function extractText(filename: string, mimeType: string, buf: Buffer): Promise<string> {
  const lower = filename.toLowerCase()

  if (mimeType === 'text/plain' || lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buf.toString('utf-8').trim()
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx')) {
    return extractDocxText(buf)
  }

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    const pdfText = await extractPdfText(buf)
    if (pdfText.length > 100) return pdfText
    // Scanned PDF — use Gemini Vision OCR
    console.log(`[tenderExtract] scanned PDF detected for ${filename}, falling back to Gemini OCR`)
    return ocrWithGemini(buf, 'application/pdf')
  }

  // DOCX legacy format
  if (lower.endsWith('.doc')) {
    throw new Error('.doc format not supported — please convert to .docx or PDF')
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

// POST /internal/tender/extract-text
// Accepts { files: [{ name, mimeType, dataBase64 }] }
// Returns { results: [{filename, text, status, error?}] }
tenderExtractRoutes.post('/internal/tender/extract-text', async (c) => {
  let body: { files?: Array<{ name?: string; mimeType?: string; dataBase64?: string }> }
  try { body = await c.req.json() } catch { return c.json({ error: 'Expected JSON body' }, 400) }

  const entries = body.files ?? []
  if (!entries.length) return c.json({ error: 'No files provided' }, 400)
  if (entries.length > 5) return c.json({ error: 'Maximum 5 files per request' }, 400)

  const results = await Promise.all(entries.map(async (entry) => {
    const filename = entry.name ?? 'unnamed'
    try {
      if (!entry.dataBase64) throw new Error('Missing dataBase64')
      const buf = Buffer.from(entry.dataBase64, 'base64')
      if (buf.length > 20 * 1024 * 1024) throw new Error('File too large (max 20 MB)')
      const text = await extractText(filename, entry.mimeType ?? '', buf)
      if (!text) throw new Error('No text could be extracted from this file')
      console.log(`[tenderExtract] ${filename} → ${text.length} chars`)
      return { filename, text, status: 'done' as const }
    } catch (err) {
      console.error(`[tenderExtract] ${filename} failed:`, (err as Error).message)
      return { filename, text: '', status: 'failed' as const, error: (err as Error).message }
    }
  }))

  return c.json({ results })
})
