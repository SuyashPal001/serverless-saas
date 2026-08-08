
function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map(row => headers.map(h => csvField(row[h] ?? '')).join(','));
  return [headerLine, ...dataLines].join('\n') + '\n';
}

function escHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toHtmlTable(rows: Array<Record<string, string | number>>, headers: string[], title: string): string {
  const headerHtml = headers.map(h => `<th>${escHtml(h)}</th>`).join('');
  const bodyHtml = rows.length
    ? rows.map(row => `<tr>${headers.map(h => `<td>${escHtml(row[h] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" style="text-align:center;color:#888">No data</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; font-size: 11pt; }
  h1 { text-align: center; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th, td { border: 1px solid #666; padding: 6px 8px; font-size: 10pt; text-align: left; }
  th { background: #e8e8e8; font-weight: bold; }
</style>
</head><body>
<h1>${escHtml(title)}</h1>
<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
</body></html>`;
}
