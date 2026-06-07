import { createStep } from '@mastra/core/workflows'
import * as crypto from 'crypto'
import { db, bidders, pqFindings, tenders } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { evaluatePqRules, type PqRuleInput } from '../rules/tenderPqRules.js'
import { tenderInputSchema, pqStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'
import { tenderDocumentReaderAgent } from '../agents/tenderDocumentReaderAgent.js'
import { retrieveTenderChunks } from '../../tender/tenderRetrieve.js'

const INFERENCE_URL = process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001'
const NARRATION_MODEL = process.env.DEFAULT_MODEL ?? 'gemini-2.5-flash'

function bidderFolderId(tenantId: string, tenderId: string, stem: string): string {
  const h = crypto.createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}

interface PqField { key: string; value: string; sourcePage: number | null; sourceDoc: string | null }
interface ExtractedPq { fields: PqField[]; missingFields: string[] }

async function extractPqFields(
  tenantId: string, folderId: string, bidderName: string
): Promise<ExtractedPq> {
  const queries = [
    'annual turnover financial statements audited accounts',
    'similar work experience project value completion certificate',
    'OEM authorization letter empanelment certificate',
    'blacklisting debarment self-declaration affidavit',
  ]

  const allChunks: string[] = []
  for (const q of queries) {
    try {
      const chunks = await retrieveTenderChunks(q, tenantId, folderId, 4, 0.25)
      allChunks.push(...chunks.map((ch, i) => `[${i + 1}] ${ch.documentName} p.${ch.chunkIndex + 1}\n${ch.content}`))
    } catch { /* chunk retrieval failure is non-fatal */ }
  }

  if (!allChunks.length) return { fields: [], missingFields: ['avg_turnover_crore', 'max_similar_work_crore', 'has_oem_auth', 'is_blacklisted'] }

  const prompt = `Extract PQ (Pre-Qualification) field values for bidder "${bidderName}" from the document text below.

Return ONLY valid JSON, no markdown:
{
  "fields": [
    {"key":"avg_turnover_crore","value":"<avg annual turnover in crore, last 3 FYs>","sourcePage":<page>,"sourceDoc":"<doc section>"},
    {"key":"max_similar_work_crore","value":"<highest single similar project value in crore>","sourcePage":<page>,"sourceDoc":"<doc section>"},
    {"key":"has_oem_auth","value":"<1 if OEM auth found, 0 if not>","sourcePage":<page or null>,"sourceDoc":"<doc or null>"},
    {"key":"is_blacklisted","value":"<0 if not blacklisted / declaration found, 1 if blacklisted>","sourcePage":<page or null>,"sourceDoc":"<doc or null>"}
  ],
  "missingFields": ["<key not found in text>"]
}

RULES:
- Values must be numbers (as strings). If not found in text, omit from fields and add key to missingFields.
- avg_turnover_crore: sum the 3 FY turnover figures and divide by 3; if fewer than 3 years stated, use what is available.
- Never fabricate. If text doesn't state a value, it is missing.

DOCUMENT TEXT:
${allChunks.join('\n\n').slice(0, 8000)}`

  try {
    const result = await tenderDocumentReaderAgent.generate(prompt)
    const raw = (result.text ?? '').trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return { fields: [], missingFields: ['avg_turnover_crore', 'max_similar_work_crore', 'has_oem_auth', 'is_blacklisted'] }
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as ExtractedPq
  } catch {
    return { fields: [], missingFields: ['avg_turnover_crore', 'max_similar_work_crore', 'has_oem_auth', 'is_blacklisted'] }
  }
}

function parsePqThresholds(pqCriteria: Record<string, unknown>): Record<string, number> {
  const t: Record<string, number> = {}
  // New authored format: { criteria: [{criterion, threshold, verification}] }
  const criteria = pqCriteria.criteria as Array<{criterion: string; threshold: string}> | undefined
  if (Array.isArray(criteria)) {
    for (const c of criteria) {
      const m = String(c.threshold ?? '').match(/[\d]+\.?[\d]*/)
      const val = m ? parseFloat(m[0]) : null
      const key = c.criterion?.toLowerCase() ?? ''
      if (val == null) continue
      if (key.includes('turnover')) t['turnover_threshold'] = val
      else if (key.includes('similar') || key.includes('work')) t['similar_work_threshold'] = val
    }
  }
  // Old seeded format: { turnover: {threshold: N}, similarWork: {threshold: N} }
  if (typeof (pqCriteria.turnover as any)?.threshold === 'number' && !('turnover_threshold' in t))
    t['turnover_threshold'] = (pqCriteria.turnover as any).threshold
  if (typeof (pqCriteria.similarWork as any)?.threshold === 'number' && !('similar_work_threshold' in t))
    t['similar_work_threshold'] = (pqCriteria.similarWork as any).threshold
  // Fallback — keep rule engine working even if criteria not parsed
  if (!t['turnover_threshold']) t['turnover_threshold'] = 5
  if (!t['similar_work_threshold']) t['similar_work_threshold'] = 2
  return t
}

async function narrate(message: string, provision: string): Promise<string> {
  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NARRATION_MODEL,
        messages: [
          { role: 'system', content: 'Rewrite this PQ finding in one clear, formal sentence. State criterion, declared value, and whether it qualifies. Do not change numbers.' },
          { role: 'user', content: `Finding: ${message}\nProvision: ${provision}` },
        ],
        stream: false,
      }),
    })
    if (!res.ok) return message
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || message
  } catch { return message }
}

export const pqEvaluateStep = createStep({
  id: 'tender-pq-evaluate',
  inputSchema: tenderInputSchema,
  outputSchema: pqStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId } = inputData

    const bidderRows = await db.select().from(bidders).where(eq(bidders.tenderId, tenderId))
    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    const pqCriteria = (tender?.pqCriteria ?? {}) as Record<string, unknown>
    const thresholds = parsePqThresholds(pqCriteria)

    const pqBidders = bidderRows.map(b => ({
      bidderId: b.id, bidderName: b.name, displayLabel: b.displayLabel,
      documentIds: (b.documentIds as string[]) ?? [],
    }))

    const pqResults = []
    const qualifiedBidderIds: string[] = []

    for (const bidder of pqBidders) {
      const stem = bidder.displayLabel.toLowerCase().replace(/\s+/g, '-')
      const folderId = bidderFolderId(tenantId, tenderId, stem)

      console.log(`[pqEvaluate] extracting PQ fields for ${bidder.bidderName} folder=${folderId}`)
      const extracted = await extractPqFields(tenantId, folderId, bidder.bidderName)

      // Map extracted fields → numeric PqRuleInput + provenance index
      const input: PqRuleInput = {}
      const provenance: Record<string, PqField> = {}
      for (const f of extracted.fields) {
        const num = parseFloat(f.value)
        if (!isNaN(num)) { input[f.key] = num; provenance[f.key] = f }
      }

      const ruleResults = evaluatePqRules(input, thresholds)
      const overallStatus = ruleResults.some(r => r.status === 'not_qualified')
        ? 'not_qualified' : ruleResults.some(r => r.status === 'cannot_evaluate')
          ? 'cannot_evaluate' : 'qualified'

      // Delete stale pqFindings for this bidder before re-inserting
      await db.delete(pqFindings).where(and(eq(pqFindings.tenderId, tenderId), eq(pqFindings.bidderId, bidder.bidderId)))

      const findings = await Promise.all(ruleResults.map(async (r) => {
        const narration = await narrate(r.message, r.provision)
        const prov = provenance[r.inputs[0]] ?? null
        const [row] = await db.insert(pqFindings).values({
          tenantId, tenderId, bidderId: bidder.bidderId,
          ruleId: r.ruleId, ruleName: r.ruleName,
          status: r.status as 'qualified' | 'not_qualified' | 'cannot_evaluate',
          provision: r.provision, narration,
          declaredValue: r.declaredValue ?? null,
          thresholdValue: r.thresholdValue ?? null,
          sourceDoc: prov?.sourceDoc ?? null,
          sourcePage: prov?.sourcePage ?? null,
        }).returning({ id: pqFindings.id })
        return { ruleId: r.ruleId, ruleName: r.ruleName, status: r.status as 'qualified' | 'not_qualified' | 'cannot_evaluate',
          provision: r.provision, narration, declaredValue: r.declaredValue ?? null, thresholdValue: r.thresholdValue ?? null,
          sourceDoc: prov?.sourceDoc ?? null, sourcePage: prov?.sourcePage ?? null, findingId: row.id }
      }))

      if (overallStatus === 'qualified') qualifiedBidderIds.push(bidder.bidderId)
      await db.update(bidders)
        .set({ status: overallStatus === 'qualified' ? 'pq_qualified' : 'pq_disqualified' })
        .where(eq(bidders.id, bidder.bidderId))

      pqResults.push({ bidderId: bidder.bidderId, bidderName: bidder.bidderName, displayLabel: bidder.displayLabel,
        overallStatus: overallStatus as 'qualified' | 'not_qualified' | 'cannot_evaluate', findings })
    }

    return { ...inputData, bidders: pqBidders, pqResults, qualifiedBidderIds }
  },
})
