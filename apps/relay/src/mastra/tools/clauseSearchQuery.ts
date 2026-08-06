// Pure, DB-free — unit-testable in isolation, matching the pattern established
// by tenderProposalOverrides.ts/tenderContractSections.ts/tenderApprovalChain.ts
// earlier this session. Escapes literal % and _ so they aren't treated as SQL
// LIKE wildcards inside the user's own search text.
export function buildClauseSearchQuery(query: string): { whereClause: string; params: string[] } {
  const trimmed = query.trim()
  const escaped = trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`)
  return {
    whereClause: `(title ILIKE $PARAM OR content ILIKE $PARAM OR tags::text ILIKE $PARAM)`,
    params: [`%${escaped}%`],
  }
}
