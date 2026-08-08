// Pure, DB-free — unit-testable in isolation, matching the pattern established
// by tenderProposalOverrides.ts/tenderContractSections.ts/tenderApprovalChain.ts
// earlier this session. Escapes literal %, _, and \ so they aren't treated as
// SQL LIKE wildcards inside the user's own search text, then wraps the result
// in wildcards ready to use directly as a Drizzle `sql` template parameter.
export function escapeLikePattern(query: string): string {
  const trimmed = query.trim()
  const escaped = trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}
