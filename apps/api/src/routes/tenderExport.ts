// Generates Word-compatible HTML (.doc) — no external deps, opens natively in MS Word.
// Word recognises the mso namespace declarations and renders tables/headings correctly.

type TenderRow = { rfpNumber: string; title: string; department: string; budget: string | null };
type SectionRow = { sectionNo: string; title: string; blockType: string; content: unknown };

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

function sectionBody(s: SectionRow): string {
  const content = (s.content ?? {}) as Record<string, unknown>;

  if (s.blockType === 'prose' || s.blockType === 'annexure') {
    const text = (content.text as string) ?? '';
    return text.split('\n').filter(l => l.trim()).map(l => `<p>${esc(l)}</p>`).join('');
  }

  if (s.blockType === 'criteria-table') {
    const rows = (content.rows as Array<{ criterion: string; threshold: string; verification: string }>) ?? [];
    return `<table>${tableRow(['Criterion', 'Threshold', 'Verification'], true)}${rows.map(r => tableRow([r.criterion, r.threshold, r.verification])).join('')}</table>`;
  }

  if (s.blockType === 'spec-table') {
    const rows = (content.rows as Array<{ metric: string; target: string; measurement: string }>) ?? [];
    return `<table>${tableRow(['Metric', 'Target', 'Measurement'], true)}${rows.map(r => tableRow([r.metric, r.target, r.measurement])).join('')}</table>`;
  }

  if (s.blockType === 'line-item-table') {
    const rows = (content.rows as Array<{ slNo: number; item: string; unit: string; qty: number; remarks?: string }>) ?? [];
    return `<table>${tableRow(['S.No', 'Item', 'Unit', 'Qty', 'Remarks'], true)}${rows.map(r => tableRow([String(r.slNo), r.item, r.unit, String(r.qty), r.remarks ?? ''])).join('')}</table>`;
  }

  return '';
}

export function buildWordDoc(tender: TenderRow, sections: SectionRow[]): string {
  const body = sections.map(s =>
    `<h2>${esc(s.sectionNo)}. ${esc(s.title)}</h2>${sectionBody(s)}<br/>`
  ).join('');

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
  xmlns:w='urn:schemas-microsoft-com:office:word'
  xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8"/>
<title>${esc(tender.rfpNumber)}</title>
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
<p style="text-align:center">${esc(tender.department)}</p>
<hr/>
${body}
</body>
</html>`;
}
