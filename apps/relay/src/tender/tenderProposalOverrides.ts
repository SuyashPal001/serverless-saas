import type { ProposalPqOverride } from './tenderProposalContent.js'

export interface OfficerActionRow {
  findingId: string | null
  action: 'accept' | 'override' | 'escalate'
  rationale: string | null
  createdAt: Date
}

// Reduce to each finding's most recent officer action, then keep only those
// whose latest action is 'override' — a later escalate/accept must supersede
// an earlier override, not be silently ignored in its favor.
export function latestPqOverrides(rows: OfficerActionRow[]): ProposalPqOverride[] {
  const latestByFindingId = new Map<string, OfficerActionRow>()
  for (const row of rows) {
    if (row.findingId == null) continue
    const current = latestByFindingId.get(row.findingId)
    if (!current || row.createdAt > current.createdAt) latestByFindingId.set(row.findingId, row)
  }
  return Array.from(latestByFindingId.values())
    .filter(row => row.action === 'override')
    .map(row => ({ findingId: row.findingId as string, rationale: row.rationale }))
}
