// DB reconstruction helpers — rebuild accumulated pipeline state from persisted findings.
// Used by advisorRunTools to provide correct inputData to each step's execute().
import { db, bidders, pqFindings, technicalFindings, shortfalls, clarificationRequests, financialFindings } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'

export interface BidderInfo { id: string; name: string; displayLabel: string; documentIds: string[] }

export async function buildBidderMap(tenderId: string): Promise<Map<string, BidderInfo>> {
  const rows = await db.select().from(bidders).where(eq(bidders.tenderId, tenderId))
  const m = new Map<string, BidderInfo>()
  for (const r of rows) {
    m.set(r.id, { id: r.id, name: r.name, displayLabel: r.displayLabel, documentIds: (r.documentIds as string[]) ?? [] })
  }
  return m
}

export function asPqBidders(bMap: Map<string, BidderInfo>) {
  return Array.from(bMap.values()).map(b => ({
    bidderId: b.id, bidderName: b.name, displayLabel: b.displayLabel, documentIds: b.documentIds,
  }))
}

export async function buildPqResults(tenderId: string, tenantId: string, bMap: Map<string, BidderInfo>) {
  const rows = await db.select().from(pqFindings).where(
    and(eq(pqFindings.tenderId, tenderId), eq(pqFindings.tenantId, tenantId))
  )
  const grouped = new Map<string, typeof rows>()
  for (const r of rows) {
    const arr = grouped.get(r.bidderId) ?? []
    arr.push(r)
    grouped.set(r.bidderId, arr)
  }
  return Array.from(grouped.entries()).map(([bidderId, findings]) => {
    const b = bMap.get(bidderId)
    const overallStatus = findings.some(f => f.status === 'not_qualified') ? 'not_qualified' as const
      : findings.some(f => f.status === 'cannot_evaluate') ? 'cannot_evaluate' as const
      : 'qualified' as const
    return {
      bidderId, bidderName: b?.name ?? '', displayLabel: b?.displayLabel ?? '',
      overallStatus,
      findings: findings.map(f => ({
        ruleId: f.ruleId, ruleName: f.ruleName,
        status: f.status as 'qualified' | 'not_qualified' | 'cannot_evaluate',
        provision: f.provision, narration: f.narration,
        declaredValue: f.declaredValue ?? null, thresholdValue: f.thresholdValue ?? null,
        sourceDoc: f.sourceDoc ?? null, sourcePage: f.sourcePage ?? null,
        findingId: f.id,
      })),
    }
  })
}

export async function buildTechResults(tenderId: string, tenantId: string, bMap: Map<string, BidderInfo>) {
  const rows = await db.select().from(technicalFindings).where(
    and(eq(technicalFindings.tenderId, tenderId), eq(technicalFindings.tenantId, tenantId))
  )
  const grouped = new Map<string, typeof rows>()
  for (const r of rows) {
    const arr = grouped.get(r.bidderId) ?? []
    arr.push(r)
    grouped.set(r.bidderId, arr)
  }
  return Array.from(grouped.entries()).map(([bidderId, clauses]) => {
    const b = bMap.get(bidderId)
    return {
      bidderId, bidderName: b?.name ?? '', displayLabel: b?.displayLabel ?? '',
      clauses: clauses.map(c => ({
        clauseNo: c.clauseNo, clauseTitle: c.clauseTitle,
        status: c.status as 'complied' | 'deviation' | 'not_found' | 'cannot_evaluate',
        narration: c.narration,
        rfpRequirement: c.rfpRequirement ?? undefined,
        bidderResponse: c.bidderResponse ?? undefined,
        sourceDoc: c.sourceDoc ?? null, sourcePage: c.sourcePage ?? null,
        findingId: c.id,
      })),
      compliedCount: clauses.filter(c => c.status === 'complied').length,
      deviationCount: clauses.filter(c => c.status === 'deviation').length,
      notFoundCount: clauses.filter(c => c.status === 'not_found').length,
    }
  })
}

export async function buildShortfallItems(tenderId: string, tenantId: string, bMap: Map<string, BidderInfo>) {
  const sfRows = await db.select().from(shortfalls).where(
    and(eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId))
  )
  const crRows = await db.select().from(clarificationRequests).where(
    and(eq(clarificationRequests.tenderId, tenderId), eq(clarificationRequests.tenantId, tenantId))
  )
  const crByShortfall = new Map<string, typeof crRows[0]>()
  for (const cr of crRows) {
    if (cr.shortfallId) crByShortfall.set(cr.shortfallId, cr)
  }
  return sfRows.map(sf => {
    const b = bMap.get(sf.bidderId)
    const cr = crByShortfall.get(sf.id)
    return {
      shortfallId: sf.id, bidderId: sf.bidderId, bidderName: b?.name ?? '',
      discrepancy: sf.discrepancy, sourceDoc: sf.sourceDoc ?? null, sourcePage: sf.sourcePage ?? null,
      clarificationId: cr?.id, draftedText: cr?.draftedText ?? '', status: sf.status,
    }
  })
}

export async function buildFinResults(tenderId: string, tenantId: string, bMap: Map<string, BidderInfo>) {
  const rows = await db.select().from(financialFindings).where(
    and(eq(financialFindings.tenderId, tenderId), eq(financialFindings.tenantId, tenantId))
  )
  return rows.map(r => {
    const b = bMap.get(r.bidderId)
    return {
      bidderId: r.bidderId, bidderName: b?.name ?? '', displayLabel: b?.displayLabel ?? '',
      boqLines: (r.boqLines as any[]) ?? [],
      totalAmount: parseFloat(String(r.totalAmount)),
      arithmeticCorrection: parseFloat(String(r.arithmeticCorrection ?? '0')),
      correctedTotal: parseFloat(String(r.correctedTotal)),
      isL1: r.isL1 === 'yes',
      l1Margin: r.l1Margin != null ? parseFloat(String(r.l1Margin)) : null,
      sourceDoc: r.sourceDoc ?? null, sourcePage: r.sourcePage ?? null,
      findingId: r.id,
    }
  })
}
