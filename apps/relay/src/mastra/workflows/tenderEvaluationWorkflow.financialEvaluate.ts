import { createStep } from '@mastra/core/workflows'
import * as crypto from 'crypto'
import { db, bidders, financialFindings, rfpSections } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { shortfallStepOutputSchema, finStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'
import { tenderDocumentReaderAgent } from '../agents/tenderDocumentReaderAgent.js'
import { retrieveTenderChunks } from '../../tender/tenderRetrieve.js'

function bidderFolderId(tenantId: string, tenderId: string, stem: string): string {
  const h = crypto.createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}

interface RfpBoqItem { slNo: number; item: string; unit: string; qty: number }
interface ExtractedBoqRow { slNo: number; item: string; unit: string; qty: number; unitRate: number; amount: number; sourcePage: number | null }
interface ExtractedBoq { rows: ExtractedBoqRow[]; statedGrandTotal: number | null; sourceDoc: string | null; sourcePage: number | null; cannotEvaluate: boolean }

async function getRfpBoq(tenderId: string, tenantId: string): Promise<RfpBoqItem[]> {
  const [section] = await db.select().from(rfpSections).where(
    and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId), eq(rfpSections.sectionNo, 'S6'))
  )
  if (!section) return []
  const content = section.content as { rows?: RfpBoqItem[] }
  return Array.isArray(content?.rows) ? content.rows : []
}

async function extractPricedBoq(
  tenantId: string, folderId: string, bidderName: string, rfpBoq: RfpBoqItem[]
): Promise<ExtractedBoq> {
  const queries = [
    'bill of quantities price schedule quoted rate unit rate amount financial bid',
    'BOQ price schedule cost breakdown total amount',
    'financial offer rate quoted cost item unit price',
  ]
  const allChunks: string[] = []
  for (const q of queries) {
    try {
      const chunks = await retrieveTenderChunks(q, tenantId, folderId, 5, 0.2)
      allChunks.push(...chunks.map((ch, i) => `[${i + 1}] ${ch.documentName} p.${ch.chunkIndex + 1}\n${ch.content}`))
    } catch { /* non-fatal */ }
  }

  if (!allChunks.length) return { rows: [], sourceDoc: null, sourcePage: null, cannotEvaluate: true }

  const rfpItemList = rfpBoq.map(r => `  Sl.${r.slNo}: "${r.item}" — ${r.qty} ${r.unit}`).join('\n')

  const prompt = `Extract the complete priced BOQ from the financial bid documents of bidder "${bidderName}".

RFP BOQ template (use for item naming hints only — do NOT use as a filter):
${rfpItemList || '  (No RFP BOQ template — extract all BOQ line items found)'}

Return ONLY valid JSON, no markdown:
{
  "rows": [
    {"slNo": 1, "item": "<item name>", "unit": "<unit>", "qty": <qty>, "unitRate": <unit rate>, "amount": <line total>, "sourcePage": <page or null>}
  ],
  "statedGrandTotal": <bidder's stated Grand Total as a number, null if not found>
}

RULES:
- Include EVERY line item the bidder submitted — do not omit lines just because they are absent from the RFP template.
- For recurring/AMC lines that show both a per-period rate and a multi-period total (e.g. "AMC @ ₹0.59 Cr/yr … Total 1.70 Cr"), use the TOTAL column value as amount and derive unitRate = amount / qty.
- unitRate and amount must be plain numbers (no ₹, no commas, no text).
- statedGrandTotal: the single "Grand Total" or "Total Bid Value" figure from the document; null if absent.
- Never fabricate values — only include figures explicitly stated in the text.
- sourcePage: page number from the document header/footer, null if not determinable.

DOCUMENT TEXT:
${allChunks.join('\n\n').slice(0, 9000)}`

  try {
    const result = await tenderDocumentReaderAgent.generate(prompt)
    const raw = (result.text ?? '').trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return { rows: [], statedGrandTotal: null, sourceDoc: null, sourcePage: null, cannotEvaluate: true }
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { rows?: ExtractedBoqRow[]; statedGrandTotal?: number | null }
    const rows = Array.isArray(parsed.rows) ? parsed.rows.filter(r => typeof r.amount === 'number' && r.amount > 0) : []
    if (!rows.length) return { rows: [], statedGrandTotal: null, sourceDoc: null, sourcePage: null, cannotEvaluate: true }
    const sourcePage = rows.find(r => r.sourcePage != null)?.sourcePage ?? null
    const statedGrandTotal = typeof parsed.statedGrandTotal === 'number' && parsed.statedGrandTotal > 0 ? parsed.statedGrandTotal : null
    return { rows, statedGrandTotal, sourceDoc: 'Financial Bid — BOQ Schedule', sourcePage, cannotEvaluate: false }
  } catch {
    return { rows: [], statedGrandTotal: null, sourceDoc: null, sourcePage: null, cannotEvaluate: true }
  }
}

function applyArithmeticCorrection(
  rows: ExtractedBoqRow[], statedGrandTotal: number | null
): { boqLines: object[]; totalAmount: number; correction: number; correctedTotal: number } {
  let lineSum = 0
  let recomputedSum = 0
  const boqLines = rows.map(r => {
    const qty = r.qty ?? null
    const unitRate = r.unitRate ?? null
    const recomputed = (qty != null && unitRate != null)
      ? Math.round(qty * unitRate * 100) / 100
      : r.amount
    const stated = r.amount
    lineSum += stated
    recomputedSum += recomputed
    return {
      item: r.item, rfpQty: qty, unit: r.unit ?? null,
      quotedRate: unitRate, amount: stated,
      correctedAmount: recomputed, arithmeticDelta: Math.round((recomputed - stated) * 100) / 100,
      sourcePage: r.sourcePage ?? null,
    }
  })
  // Use bidder's stated Grand Total as authoritative when present; surface delta as arithmetic correction
  const totalAmount = statedGrandTotal ?? Math.round(lineSum * 100) / 100
  const correctedTotal = Math.round(recomputedSum * 100) / 100
  const correction = Math.round((correctedTotal - totalAmount) * 100) / 100
  return { boqLines, totalAmount, correction, correctedTotal }
}

export const financialEvaluateStep = createStep({
  id: 'tender-financial-evaluate',
  inputSchema: shortfallStepOutputSchema,
  outputSchema: finStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, qualifiedBidderIds } = inputData

    const rfpBoq = await getRfpBoq(tenderId, tenantId)
    const finResults = []

    // Wipe all prior financial findings for this tender up-front (idempotent re-run)
    await db.delete(financialFindings).where(eq(financialFindings.tenderId, tenderId))

    for (const bidderId of qualifiedBidderIds) {
      const [bidder] = await db.select().from(bidders).where(
        and(eq(bidders.id, bidderId), eq(bidders.tenantId, tenantId))
      )
      if (!bidder) continue

      const stem = bidder.displayLabel.toLowerCase().replace(/\s+/g, '-')
      const folderId = bidderFolderId(tenantId, tenderId, stem)

      console.log(`[financialEvaluate] extracting BOQ for ${bidder.name} folder=${folderId}`)
      let extracted: ExtractedBoq
      try {
        extracted = await extractPricedBoq(tenantId, folderId, bidder.name, rfpBoq)
      } catch (extractErr) {
        console.error(`[financialEvaluate] extraction error for ${bidder.name}:`, (extractErr as Error).message)
        extracted = { rows: [], statedGrandTotal: null, sourceDoc: null, sourcePage: null, cannotEvaluate: true }
      }

      if (extracted.cannotEvaluate || !extracted.rows.length) {
        const [row] = await db.insert(financialFindings).values({
          tenantId, tenderId, bidderId,
          boqLines: [] as any,
          totalAmount: '0', arithmeticCorrection: '0', correctedTotal: '0',
          isL1: 'no', sourceDoc: null, sourcePage: null,
        }).returning({ id: financialFindings.id })
        await db.update(bidders).set({ status: 'financial_evaluated' }).where(eq(bidders.id, bidderId))
        finResults.push({
          bidderId, bidderName: bidder.name, displayLabel: bidder.displayLabel,
          boqLines: [], totalAmount: 0, arithmeticCorrection: 0,
          correctedTotal: 0, isL1: false, l1Margin: null,
          sourceDoc: null, sourcePage: null, findingId: row.id, cannotEvaluate: true,
        })
        continue
      }

      const { boqLines, totalAmount, correction, correctedTotal } = applyArithmeticCorrection(extracted.rows, extracted.statedGrandTotal)

      const [row] = await db.insert(financialFindings).values({
        tenantId, tenderId, bidderId,
        boqLines: boqLines as any,
        totalAmount: String(totalAmount),
        arithmeticCorrection: String(correction),
        correctedTotal: String(correctedTotal),
        isL1: 'pending',
        sourceDoc: extracted.sourceDoc, sourcePage: extracted.sourcePage,
      }).returning({ id: financialFindings.id })

      await db.update(bidders).set({ status: 'financial_evaluated' }).where(eq(bidders.id, bidderId))

      finResults.push({
        bidderId, bidderName: bidder.name, displayLabel: bidder.displayLabel,
        boqLines, totalAmount, arithmeticCorrection: correction,
        correctedTotal, isL1: false, l1Margin: null,
        sourceDoc: extracted.sourceDoc, sourcePage: extracted.sourcePage,
        findingId: row.id, cannotEvaluate: false,
      })
    }

    // Rank by corrected total (exclude cannot_evaluate bidders from L1 competition)
    const evaluatable = finResults.filter(r => !(r as any).cannotEvaluate && r.correctedTotal > 0)
    const sorted = [...evaluatable].sort((a, b) => a.correctedTotal - b.correctedTotal)
    const l1 = sorted[0]

    if (!l1) return { ...inputData, finResults: finResults as any, l1BidderId: '', l1Amount: 0 }

    const withRank = finResults.map(r => ({
      ...r,
      isL1: r.bidderId === l1.bidderId,
      l1Margin: r.bidderId === l1.bidderId ? null : r.correctedTotal > 0 ? r.correctedTotal - l1.correctedTotal : null,
    }))

    for (const r of withRank) {
      if (!r.findingId) continue
      await db.update(financialFindings)
        .set({ isL1: r.isL1 ? 'yes' : 'no', l1Margin: r.l1Margin != null ? String(r.l1Margin) : null })
        .where(eq(financialFindings.id, r.findingId))
    }

    await db.update(bidders).set({ status: 'awarded' }).where(eq(bidders.id, l1.bidderId))

    return { ...inputData, finResults: withRank as any, l1BidderId: l1.bidderId, l1Amount: l1.correctedTotal }
  },
})
