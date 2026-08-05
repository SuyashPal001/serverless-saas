export interface ProposalTender { rfpNumber: string; title: string; department: string; budget: string | null }
export interface ProposalBidder { id: string; name: string; displayLabel: string }
export interface ProposalPqFinding { bidderId: string; status: 'qualified' | 'not_qualified' | 'cannot_evaluate'; ruleName: string; narration: string }
export interface ProposalTechFinding { bidderId: string; status: 'complied' | 'deviation' | 'not_found' | 'cannot_evaluate' }
export interface ProposalFinFinding { bidderId: string; correctedTotal: string; isL1: string }
export interface ProposalShortfall { bidderId: string; discrepancy: string; status: string }

export interface ProposalContentInput {
  tender: ProposalTender
  bidders: ProposalBidder[]
  pqFindings: ProposalPqFinding[]
  technicalFindings: ProposalTechFinding[]
  financialFindings: ProposalFinFinding[]
  shortfalls: ProposalShortfall[]
}

export interface ComplianceRow {
  bidderId: string; displayLabel: string; bidderName: string
  pqStatus: 'qualified' | 'not_qualified' | 'cannot_evaluate' | 'pending'
  techComplied: number; techDeviations: number; techNotFound: number
  disqualified: boolean
}

export interface PriceComparisonRow {
  bidderId: string; displayLabel: string
  correctedTotal: number; isL1: boolean
  varianceFromEstimatePct: number | null
}

export interface PriceComparison {
  internalEstimate: number | null
  rows: PriceComparisonRow[]
}

export interface RejectionGround { bidderId: string; displayLabel: string; reasons: string[] }

export interface ProposalContent {
  execSummary: string
  complianceMatrix: ComplianceRow[]
  priceComparison: PriceComparison
  rejectionGrounds: RejectionGround[]
  recommendation: string
}

function pqStatusFor(bidderId: string, pqFindings: ProposalPqFinding[]): ComplianceRow['pqStatus'] {
  const rows = pqFindings.filter(f => f.bidderId === bidderId)
  if (!rows.length) return 'pending'
  if (rows.some(r => r.status === 'not_qualified')) return 'not_qualified'
  if (rows.some(r => r.status === 'cannot_evaluate')) return 'cannot_evaluate'
  return 'qualified'
}

function techStatsFor(bidderId: string, technicalFindings: ProposalTechFinding[]) {
  const rows = technicalFindings.filter(f => f.bidderId === bidderId)
  return {
    complied: rows.filter(r => r.status === 'complied').length,
    deviations: rows.filter(r => r.status === 'deviation').length,
    notFound: rows.filter(r => r.status === 'not_found').length,
  }
}

function crFormat(rupees: number): string {
  return `₹${(rupees / 1e7).toFixed(2)} Cr`
}

export function buildProposalContent(input: ProposalContentInput): ProposalContent {
  const { tender, bidders, pqFindings, technicalFindings, financialFindings, shortfalls } = input

  const complianceMatrix: ComplianceRow[] = bidders.map(b => {
    const pqStatus = pqStatusFor(b.id, pqFindings)
    const tech = techStatsFor(b.id, technicalFindings)
    return {
      bidderId: b.id, displayLabel: b.displayLabel, bidderName: b.name,
      pqStatus,
      techComplied: tech.complied, techDeviations: tech.deviations, techNotFound: tech.notFound,
      disqualified: pqStatus === 'not_qualified',
    }
  })

  const internalEstimate = tender.budget != null ? Number(tender.budget) : null
  const priceRows: PriceComparisonRow[] = financialFindings.map(f => {
    const b = bidders.find(x => x.id === f.bidderId)
    const correctedTotal = Number(f.correctedTotal)
    return {
      bidderId: f.bidderId, displayLabel: b?.displayLabel ?? '',
      correctedTotal, isL1: f.isL1 === 'yes',
      varianceFromEstimatePct: internalEstimate != null && internalEstimate > 0
        ? Math.round(((correctedTotal - internalEstimate) / internalEstimate) * 10000) / 100
        : null,
    }
  }).sort((a, b) => a.correctedTotal - b.correctedTotal)

  const rejectionGrounds: RejectionGround[] = complianceMatrix
    .filter(r => r.disqualified)
    .map(r => {
      const pqReasons = pqFindings
        .filter(f => f.bidderId === r.bidderId && f.status === 'not_qualified')
        .map(f => `${f.ruleName}: ${f.narration}`)
      const shortfallReasons = shortfalls
        .filter(s => s.bidderId === r.bidderId && s.status !== 'closed')
        .map(s => s.discrepancy)
      return { bidderId: r.bidderId, displayLabel: r.displayLabel, reasons: [...pqReasons, ...shortfallReasons] }
    })

  const l1Row = priceRows.find(r => r.isL1)
  const l1Bidder = l1Row ? bidders.find(b => b.id === l1Row.bidderId) : undefined
  const disqualifiedCount = rejectionGrounds.length

  const execSummary = l1Row && l1Bidder
    ? `This proposal covers evaluation of ${bidders.length} bidder(s) for ${tender.rfpNumber} — ${tender.title} (${tender.department}). ` +
      `${disqualifiedCount} bidder(s) were disqualified at the pre-qualification stage. ` +
      `The lowest evaluated responsive bidder is ${l1Bidder.name} (${l1Bidder.displayLabel}) at ${crFormat(l1Row.correctedTotal)}` +
      (l1Row.varianceFromEstimatePct != null ? `, ${l1Row.varianceFromEstimatePct >= 0 ? 'above' : 'below'} the internal estimate by ${Math.abs(l1Row.varianceFromEstimatePct).toFixed(2)}%.` : '.')
    : `This proposal covers evaluation of ${bidders.length} bidder(s) for ${tender.rfpNumber} — ${tender.title} (${tender.department}). ` +
      `${disqualifiedCount} bidder(s) were disqualified at the pre-qualification stage. ` +
      `Financial evaluation is not yet complete; no L1 recommendation is available.`

  const recommendation = l1Row && l1Bidder
    ? `Award recommended to ${l1Bidder.name} (${l1Bidder.displayLabel}) as the lowest evaluated responsive bidder at ${crFormat(l1Row.correctedTotal)}, subject to approver sign-off.`
    : `Recommendation not yet available — financial evaluation is not complete for this tender.`

  return {
    execSummary,
    complianceMatrix,
    priceComparison: { internalEstimate, rows: priceRows },
    rejectionGrounds,
    recommendation,
  }
}
