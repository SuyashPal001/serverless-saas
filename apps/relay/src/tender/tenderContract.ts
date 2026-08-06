// apps/relay/src/tender/tenderContract.ts
import { db, tenders, bidders, financialFindings, rfpSections, tenderContracts } from '@serverless-saas/database'
import { eq, and, max } from 'drizzle-orm'
import { buildContractContent, type ContractContentInput, type ContractSourceSection } from './tenderContractContent.js'
import { writeTenderAuditLog } from '../mastra/workflows/tenderAuditLog.js'

const CONTRACT_SOURCE_SECTIONS = ['S3', 'S5', 'S8'] // Scope of Work, Service Levels (SLA/KPI), Contract Terms/Compliance/Security

interface RfpSectionRow { sectionNo: string; title: string; content: unknown; acceptedAt: Date | null }

function sectionText(row: RfpSectionRow): string {
  const content = row.content as { text?: string; clauses?: Array<{ clauseNo?: string; title?: string; text?: string }> } | null
  if (!content) return ''
  const parts: string[] = []
  if (typeof content.text === 'string' && content.text.trim()) parts.push(content.text)
  if (Array.isArray(content.clauses)) {
    for (const c of content.clauses) {
      const label = [c.clauseNo, c.title].filter(Boolean).join(' ')
      parts.push(label ? `${label}: ${c.text ?? ''}` : (c.text ?? ''))
    }
  }
  return parts.join('\n')
}

export async function generateContract(tenderId: string, tenantId: string): Promise<{ contractId: string; version: number }> {
  const [tender] = await db.select().from(tenders).where(
    and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId))
  )
  if (!tender) throw new Error('tender not found')

  const [awardedBidder] = await db.select().from(bidders).where(
    and(eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId), eq(bidders.status, 'awarded'))
  )
  if (!awardedBidder) throw new Error('no awarded bidder — tender is not ready for contract formulation')

  const [[finding], sectionRows] = await Promise.all([
    db.select().from(financialFindings).where(
      and(eq(financialFindings.tenderId, tenderId), eq(financialFindings.tenantId, tenantId), eq(financialFindings.bidderId, awardedBidder.id))
    ),
    db.select().from(rfpSections).where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId))) as Promise<RfpSectionRow[]>,
  ])
  if (!finding) throw new Error('no financial finding for the awarded bidder — cannot determine contract value')

  const sourceSections: ContractSourceSection[] = sectionRows
    .filter(r => CONTRACT_SOURCE_SECTIONS.includes(r.sectionNo) && r.acceptedAt != null)
    .sort((a, b) => CONTRACT_SOURCE_SECTIONS.indexOf(a.sectionNo) - CONTRACT_SOURCE_SECTIONS.indexOf(b.sectionNo))
    .map(r => ({ sectionNo: r.sectionNo, title: r.title, text: sectionText(r) }))
    .filter(s => s.text.trim().length > 0)

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
