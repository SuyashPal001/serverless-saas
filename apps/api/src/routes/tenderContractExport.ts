// apps/api/src/routes/tenderContractExport.ts
// Generates Word-compatible HTML (.doc) for a tender award contract — same technique as tenderProposalExport.ts.

interface ContractTenderRow { rfpNumber: string; title: string; department: string }
interface ContractSectionRow { sectionNo: string; title: string; text: string }
interface ContractRow {
  contractorName: string; contractorDisplayLabel: string; contractorContactEmail: string | null
  contractValue: string
  sections: ContractSectionRow[]
  version: number
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function crFmt(rupees: number): string {
  return `₹${(rupees / 1e7).toFixed(2)} Cr`;
}

export function buildContractWordDoc(tender: ContractTenderRow, contract: ContractRow): string {
  const sectionsHtml = contract.sections.map(s =>
    `<h2>${esc(s.sectionNo)}. ${esc(s.title)}</h2>${s.text.split('\n').filter(l => l.trim()).map(l => `<p>${esc(l)}</p>`).join('')}`
  ).join('');

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
  xmlns:w='urn:schemas-microsoft-com:office:word'
  xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8"/>
<title>${esc(tender.rfpNumber)} — Contract v${contract.version}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 72pt; }
  h1   { text-align: center; font-size: 16pt; }
  h2   { font-size: 13pt; margin-top: 18pt; border-bottom: 1pt solid #333; }
  table{ border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1pt solid #666; padding: 4pt 6pt; font-size: 10pt; }
  th   { background: #e8e8e8; font-weight: bold; }
  p    { margin: 4pt 0; }
</style>
</head>
<body>
<h1>${esc(tender.rfpNumber)}</h1>
<h1>${esc(tender.title)}</h1>
<p style="text-align:center">${esc(tender.department)} — Contract v${contract.version}</p>
<hr/>
<h2>Contractor Details</h2>
<p>Name: ${esc(contract.contractorName)} (${esc(contract.contractorDisplayLabel)})</p>
<p>Contact: ${contract.contractorContactEmail ? esc(contract.contractorContactEmail) : 'Not on file'}</p>
<p>Contract Value: ${crFmt(Number(contract.contractValue))}</p>
${sectionsHtml}
</body>
</html>`;
}
