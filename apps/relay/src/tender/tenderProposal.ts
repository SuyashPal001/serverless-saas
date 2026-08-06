// apps/relay/src/tender/tenderProposal.ts
import { db, tenders, bidders, pqFindings, technicalFindings, financialFindings, shortfalls, tenderProposals, tenderOfficerActions } from '@serverless-saas/database'
import { eq, and, max } from 'drizzle-orm'
import { buildProposalContent, type ProposalContentInput } from './tenderProposalContent.js'
import { latestPqOverrides } from './tenderProposalOverrides.js'
import { writeTenderAuditLog } from '../mastra/workflows/tenderAuditLog.js'

export async function generateProposal(tenderId: string, tenantId: string): Promise<{ proposalId: string; version: number }> {
  const [tender] = await db.select().from(tenders).where(
    and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId))
  )
  if (!tender) throw new Error('tender not found')

  const [bidderRows, pqRows, techRows, finRows, shortfallRows, officerActionRows] = await Promise.all([
    db.select().from(bidders).where(and(eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId))),
    db.select().from(pqFindings).where(and(eq(pqFindings.tenderId, tenderId), eq(pqFindings.tenantId, tenantId))),
    db.select().from(technicalFindings).where(and(eq(technicalFindings.tenderId, tenderId), eq(technicalFindings.tenantId, tenantId))),
    db.select().from(financialFindings).where(and(eq(financialFindings.tenderId, tenderId), eq(financialFindings.tenantId, tenantId))),
    db.select().from(shortfalls).where(and(eq(shortfalls.tenderId, tenderId), eq(shortfalls.tenantId, tenantId))),
    // All pq-finding officer actions (not just 'override') — an officer's most recent
    // decision on a finding must win, so a later escalate/accept can supersede an
    // earlier override. Reduced to latest-per-findingId below, in JS (this table has
    // no unique constraint on findingId and is append-only, so SQL-side dedup would
    // need DISTINCT ON, which isn't worth introducing for this data volume).
    db.select().from(tenderOfficerActions).where(and(
      eq(tenderOfficerActions.tenderId, tenderId), eq(tenderOfficerActions.tenantId, tenantId),
      eq(tenderOfficerActions.findingType, 'pq'),
    )),
  ])

  const input: ProposalContentInput = {
    tender: { rfpNumber: tender.rfpNumber, title: tender.title, department: tender.department, budget: tender.budget },
    bidders: bidderRows.map(b => ({ id: b.id, name: b.name, displayLabel: b.displayLabel })),
    pqFindings: pqRows.map(f => ({ id: f.id, bidderId: f.bidderId, status: f.status, ruleName: f.ruleName, narration: f.narration })),
    technicalFindings: techRows.map(f => ({ bidderId: f.bidderId, status: f.status })),
    financialFindings: finRows.map(f => ({ bidderId: f.bidderId, correctedTotal: f.correctedTotal, isL1: f.isL1 })),
    shortfalls: shortfallRows.map(s => ({ bidderId: s.bidderId, discrepancy: s.discrepancy, status: s.status })),
    pqOverrides: latestPqOverrides(officerActionRows),
  }

  const content = buildProposalContent(input)

  // Append-only, versioned — unlike Document Checker, proposals keep history (OIL requirement).
  const [{ maxVersion }] = await db.select({ maxVersion: max(tenderProposals.version) }).from(tenderProposals)
    .where(and(eq(tenderProposals.tenderId, tenderId), eq(tenderProposals.tenantId, tenantId)))
  const version = (maxVersion ?? 0) + 1

  const [row] = await db.insert(tenderProposals).values({
    tenantId, tenderId, status: 'draft', version,
    execSummary: content.execSummary,
    complianceMatrix: content.complianceMatrix,
    priceComparison: content.priceComparison,
    rejectionGrounds: content.rejectionGrounds,
    recommendation: content.recommendation,
  }).returning({ id: tenderProposals.id })

  await writeTenderAuditLog({
    tenantId, actorId: 'system', action: 'proposal_generated', resource: 'tender', resourceId: tenderId,
    metadata: {
      proposalId: row.id, version, disqualifiedCount: content.rejectionGrounds.length,
      overriddenCount: content.complianceMatrix.filter(r => r.overridden).length,
    },
  })

  return { proposalId: row.id, version }
}
