import { createStep } from '@mastra/core/workflows'
import { db, bidders, financialFindings } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { shortfallStepOutputSchema, finStepOutputSchema } from './tenderEvaluationWorkflow.schemas.js'

// Seeded BOQ data for qualified bidders (in production, extracted from bid docs via OCR)
const SEEDED_BOQ: Record<string, {
  boqLines: Array<{ item: string; rfpQty: number; unit: string; quotedRate: number; amount: number }>,
  sourceDoc: string; sourcePage: number
}> = {
  'Bidder A': {
    boqLines: [
      { item: 'HRMS Software License (Enterprise)', rfpQty: 1, unit: 'Lot', quotedRate: 28000000, amount: 28000000 },
      { item: 'Implementation & Customization', rfpQty: 1, unit: 'Lot', quotedRate: 25000000, amount: 25000000 },
      { item: 'Training (Classroom + Admin)', rfpQty: 1, unit: 'Lot', quotedRate: 7500000, amount: 7500000 },
      { item: 'Annual Maintenance Contract (3 yr)', rfpQty: 3, unit: 'Year', quotedRate: 5900000, amount: 17700000 },
    ],
    sourceDoc: 'Financial Bid — BOQ Schedule', sourcePage: 2,
  },
  'Bidder C': {
    boqLines: [
      { item: 'HRMS Software License (Enterprise)', rfpQty: 1, unit: 'Lot', quotedRate: 32000000, amount: 32000000 },
      { item: 'Implementation & Customization', rfpQty: 1, unit: 'Lot', quotedRate: 28500000, amount: 28500000 },
      { item: 'Training (Classroom + Admin)', rfpQty: 1, unit: 'Lot', quotedRate: 6000000, amount: 6000000 },
      { item: 'Annual Maintenance Contract (3 yr)', rfpQty: 3, unit: 'Year', quotedRate: 5000000, amount: 15000000 },
    ],
    sourceDoc: 'Financial Bid — Price Schedule', sourcePage: 3,
  },
}

export const financialEvaluateStep = createStep({
  id: 'tender-financial-evaluate',
  inputSchema: shortfallStepOutputSchema,
  outputSchema: finStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, qualifiedBidderIds } = inputData
    const finResults = []

    for (const bidderId of qualifiedBidderIds) {
      const [bidder] = await db.select().from(bidders).where(
        and(eq(bidders.id, bidderId), eq(bidders.tenantId, tenantId))
      )
      if (!bidder) continue

      const seed = SEEDED_BOQ[bidder.displayLabel] ?? SEEDED_BOQ['Bidder A']
      const totalAmount = seed.boqLines.reduce((s, l) => s + l.amount, 0)
      // Minor arithmetic correction: ₹0 for clean demo (could be non-zero for Bidder C)
      const arithmeticCorrection = bidder.displayLabel === 'Bidder C' ? 0 : 0
      const correctedTotal = totalAmount + arithmeticCorrection

      const [row] = await db.insert(financialFindings).values({
        tenantId, tenderId, bidderId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        boqLines: seed.boqLines as any,
        totalAmount: String(totalAmount),
        arithmeticCorrection: String(arithmeticCorrection),
        correctedTotal: String(correctedTotal),
        isL1: 'pending', // will update after comparing all
        sourceDoc: seed.sourceDoc, sourcePage: seed.sourcePage,
      }).returning({ id: financialFindings.id })

      await db.update(bidders).set({ status: 'financial_evaluated' }).where(eq(bidders.id, bidderId))

      finResults.push({
        bidderId, bidderName: bidder.name, displayLabel: bidder.displayLabel,
        boqLines: seed.boqLines, totalAmount, arithmeticCorrection,
        correctedTotal, isL1: false, l1Margin: null,
        sourceDoc: seed.sourceDoc, sourcePage: seed.sourcePage, findingId: row.id,
      })
    }

    // Determine L1
    const sorted = [...finResults].sort((a, b) => a.correctedTotal - b.correctedTotal)
    const l1 = sorted[0]
    if (!l1) return { ...inputData, finResults, l1BidderId: '', l1Amount: 0 }

    const withL1 = finResults.map(r => ({
      ...r,
      isL1: r.bidderId === l1.bidderId,
      l1Margin: r.bidderId === l1.bidderId ? null : r.correctedTotal - l1.correctedTotal,
    }))

    // Update isL1 in DB
    for (const r of withL1) {
      if (!r.findingId) continue
      await db.update(financialFindings)
        .set({ isL1: r.isL1 ? 'yes' : 'no', l1Margin: r.l1Margin != null ? String(r.l1Margin) : null })
        .where(eq(financialFindings.id, r.findingId))
    }

    await db.update(bidders).set({ status: 'awarded' }).where(eq(bidders.id, l1.bidderId))

    return {
      ...inputData,
      finResults: withL1,
      l1BidderId: l1.bidderId,
      l1Amount: l1.correctedTotal,
    }
  },
})
