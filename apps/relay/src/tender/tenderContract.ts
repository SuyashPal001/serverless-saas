// apps/relay/src/tender/tenderContract.ts
import { db, tenders, bidders, financialFindings, rfpSections, tenderContracts, vendors } from '@serverless-saas/database'
import { eq, and, max, desc } from 'drizzle-orm'
import { buildContractContent, type ContractContentInput, type ContractSourceSection } from './tenderContractContent.js'
import { sectionText, type RfpSectionRow } from './tenderContractSections.js'
import { writeTenderAuditLog } from '../mastra/workflows/tenderAuditLog.js'
import { checkVendorBlacklist } from '../mastra/rules/vendorBlacklist.js'

const CONTRACT_SOURCE_SECTIONS = ['S3', 'S5', 'S8'] // Scope of Work, Service Levels (SLA/KPI), Contract Terms/Compliance/Security

export async function generateContract(tenderId: string, tenantId: string): Promise<{ contractId: string; version: number }> {
  const [tender] = await db.select().from(tenders).where(
    and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId))
  )
  if (!tender) throw new Error('tender not found')

  const [awardedRow] = await db.select({ bidder: bidders, finding: financialFindings }).from(bidders)
    .innerJoin(financialFindings, and(
      eq(financialFindings.bidderId, bidders.id),
      eq(financialFindings.tenderId, bidders.tenderId),
      eq(financialFindings.tenantId, bidders.tenantId),
    ))
    .where(and(
      eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId),
      eq(bidders.status, 'awarded'), eq(financialFindings.isL1, 'yes'),
    ))
    .orderBy(desc(financialFindings.createdAt))
    .limit(1)
  if (!awardedRow) throw new Error('no awarded bidder — tender is not ready for contract formulation')
  const awardedBidder = awardedRow.bidder
  const finding = awardedRow.finding

  if (awardedBidder.vendorId) {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, awardedBidder.vendorId))
    const gate = checkVendorBlacklist(vendor ? { isBlacklisted: vendor.isBlacklisted, blacklistReason: vendor.blacklistReason } : null)
    if (gate.blocked) {
      await writeTenderAuditLog({
        tenantId, actorId: 'system', action: 'contract_blocked_blacklisted_vendor', resource: 'tender', resourceId: tenderId,
        metadata: { bidderId: awardedBidder.id, vendorId: awardedBidder.vendorId, reason: gate.reason },
      })
      throw new Error(`Cannot generate contract — awarded bidder's linked vendor is blacklisted: ${gate.reason}`)
    }
  }

  const sectionRows = await db.select().from(rfpSections)
    .where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId))) as RfpSectionRow[]

  const sourceSections: ContractSourceSection[] = sectionRows
    .filter(r => CONTRACT_SOURCE_SECTIONS.includes(r.sectionNo) && r.acceptedAt != null)
    .sort((a, b) => CONTRACT_SOURCE_SECTIONS.indexOf(a.sectionNo) - CONTRACT_SOURCE_SECTIONS.indexOf(b.sectionNo))
    .map(r => ({ sectionNo: r.sectionNo, title: r.title, text: sectionText(r) }))
    .filter(s => s.text.trim().length > 0)

  if (sourceSections.length === 0) {
    throw new Error('no accepted contract source sections — author and accept the tender\'s scope of work, service levels, and contract terms sections first')
  }

  const input: ContractContentInput = {
    tender: { rfpNumber: tender.rfpNumber, title: tender.title, department: tender.department },
    contractor: { id: awardedBidder.id, name: awardedBidder.name, displayLabel: awardedBidder.displayLabel, contactEmail: awardedBidder.contactEmail },
    contractValue: Number(finding.correctedTotal),
    sections: sourceSections,
  }

  const content = buildContractContent(input)

  // Append-only, versioned — matches tender_proposals, not document_checks.
  const [{ maxVersion }] = await db.select({ maxVersion: max(tenderContracts.version) }).from(tenderContracts)
    .where(and(eq(tenderContracts.tenderId, tenderId), eq(tenderContracts.tenantId, tenantId)))
  const version = (maxVersion ?? 0) + 1

  const [row] = await db.insert(tenderContracts).values({
    tenantId, tenderId, contractorBidderId: awardedBidder.id, status: 'draft', version,
    contractorName: content.contractorName,
    contractorDisplayLabel: content.contractorDisplayLabel,
    contractorContactEmail: content.contractorContactEmail,
    contractValue: String(content.contractValue),
    sections: content.sections,
  }).returning({ id: tenderContracts.id })

  await writeTenderAuditLog({
    tenantId, actorId: 'system', action: 'contract_generated', resource: 'tender', resourceId: tenderId,
    metadata: { contractId: row.id, version, contractorBidderId: awardedBidder.id, contractValue: content.contractValue },
  })

  return { contractId: row.id, version }
}
