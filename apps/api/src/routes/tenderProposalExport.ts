// apps/api/src/routes/tenderProposalExport.ts
// Generates Word-compatible HTML (.doc) for a tender proposal — same technique as tenderExport.ts's buildWordDoc.

interface ProposalTenderRow { rfpNumber: string; title: string; department: string }
interface ComplianceRow {
  bidderId: string; displayLabel: string; bidderName: string
  pqStatus: string; techComplied: number; techDeviations: number; techNotFound: number; disqualified: boolean
}
interface PriceComparisonRow { bidderId: string; displayLabel: string; correctedTotal: number; isL1: boolean; varianceFromEstimatePct: number | null }
interface PriceComparison { internalEstimate: number | null; rows: PriceComparisonRow[] }
interface RejectionGround { bidderId: string; displayLabel: string; reasons: string[] }
interface ProposalRow {
  execSummary: string
  complianceMatrix: ComplianceRow[]
  priceComparison: PriceComparison
  rejectionGrounds: RejectionGround[]
  recommendation: string
  version: number
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tableRow(cells: string[], header = false): string {
  const tag = header ? 'th' : 'td';
  return `<tr>${cells.map(c => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
}

function crFmt(rupees: number): string {
  return `₹${(rupees / 1e7).toFixed(2)} Cr`;
}

export function buildProposalWordDoc(tender: ProposalTenderRow, proposal: ProposalRow): string {
  const complianceTable = `<table>${tableRow(['Bidder', 'PQ Status', 'Complied', 'Deviations', 'Not Found', 'Disqualified'], true)}${
    proposal.complianceMatrix.map(r => tableRow([
      `${r.bidderName} (${r.displayLabel})`, r.pqStatus,
      String(r.techComplied), String(r.techDeviations), String(r.techNotFound),
      r.disqualified ? 'Yes' : 'No',
    ])).join('')
  }</table>`;

  const priceTable = `<p>Internal Estimate: ${proposal.priceComparison.internalEstimate != null ? crFmt(proposal.priceComparison.internalEstimate) : 'Not set'}</p>` +
    `<table>${tableRow(['Bidder', 'Corrected Total', 'Variance from Estimate', 'L1'], true)}${
      proposal.priceComparison.rows.map(r => tableRow([
        r.displayLabel, crFmt(r.correctedTotal),
        r.varianceFromEstimatePct != null ? `${r.varianceFromEstimatePct.toFixed(2)}%` : 'N/A',
        r.isL1 ? 'Yes' : 'No',
      ])).join('')
    }</table>`;

  const rejectionSection = proposal.rejectionGrounds.length
    ? proposal.rejectionGrounds.map(g => `<h3>${esc(g.displayLabel)}</h3><ul>${g.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`).join('')
    : '<p>No bidders were disqualified.</p>';

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
  xmlns:w='urn:schemas-microsoft-com:office:word'
  xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8"/>
<title>${esc(tender.rfpNumber)} — Proposal v${proposal.version}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 72pt; }
  h1   { text-align: center; font-size: 16pt; }
  h2   { font-size: 13pt; margin-top: 18pt; border-bottom: 1pt solid #333; }
  h3   { font-size: 11pt; margin-top: 10pt; }
  table{ border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1pt solid #666; padding: 4pt 6pt; font-size: 10pt; }
  th   { background: #e8e8e8; font-weight: bold; }
  p    { margin: 4pt 0; }
</style>
</head>
<body>
<h1>${esc(tender.rfpNumber)}</h1>
<h1>${esc(tender.title)}</h1>
<p style="text-align:center">${esc(tender.department)} — Proposal v${proposal.version}</p>
<hr/>
<h2>Executive Summary</h2>
<p>${esc(proposal.execSummary)}</p>
<h2>Compliance Matrix</h2>
${complianceTable}
<h2>Price Comparison</h2>
${priceTable}
<h2>Rejection Grounds</h2>
${rejectionSection}
<h2>Recommendation</h2>
<p>${esc(proposal.recommendation)}</p>
</body>
</html>`;
}
