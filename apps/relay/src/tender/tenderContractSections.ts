// apps/relay/src/tender/tenderContractSections.ts
// Pure, DB-free helper extracted from tenderContract.ts so it can be unit-tested
// without triggering a DB-connection crash (no @serverless-saas/database import here).

export interface RfpSectionContent {
  text?: string
  rows?: Array<Record<string, unknown>>
  clauses?: Array<{ clauseNo?: string; title?: string; text?: string }>
}

export interface RfpSectionRow {
  sectionNo: string
  title: string
  content: unknown
  acceptedAt: Date | null
}

export function sectionText(row: RfpSectionRow): string {
  const content = row.content as RfpSectionContent | null
  if (!content) return ''
  const parts: string[] = []
  if (typeof content.text === 'string' && content.text.trim()) parts.push(content.text)
  if (Array.isArray(content.rows) && content.rows.length > 0) {
    parts.push(content.rows.map(r => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ')).join('\n'))
  }
  if (Array.isArray(content.clauses)) {
    for (const c of content.clauses) {
      const label = [c.clauseNo, c.title].filter(Boolean).join(' ')
      parts.push(label ? `${label}: ${c.text ?? ''}` : (c.text ?? ''))
    }
  }
  return parts.join('\n')
}
