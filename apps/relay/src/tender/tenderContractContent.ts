
export interface ContractTender { rfpNumber: string; title: string; department: string }
export interface ContractContractor { id: string; name: string; displayLabel: string; contactEmail: string | null }
export interface ContractSourceSection { sectionNo: string; title: string; text: string }
export interface ContractContentInput {
  tender: ContractTender
  contractor: ContractContractor
  contractValue: number
  sections: ContractSourceSection[]
}
export interface ContractSection { sectionNo: string; title: string; text: string }
export interface ContractContent {
  contractorName: string; contractorDisplayLabel: string; contractorContactEmail: string | null
  contractValue: number
  sections: ContractSection[]
}

function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

// Replaces standalone occurrences of "bidder"/"bidders" with "contractor"/"contractors",
// preserving the case pattern of each match. Does not touch words merely containing
// "bidder" as a substring (e.g. "outbidder"). Plural handled first — \bbidder\b cannot
// match inside "bidders" (no word boundary between 'r' and 's'), so the two passes
// don't overlap or double-process.
export function substituteBidderWithContractor(text: string): string {
  return text
    .replace(/\bbidders\b/gi, (m) => matchCase('contractors', m))
    .replace(/\bbidder\b/gi, (m) => matchCase('contractor', m))
}

export function buildContractContent(input: ContractContentInput): ContractContent {
  const { contractor, contractValue, sections } = input
  return {
    contractorName: contractor.name,
    contractorDisplayLabel: contractor.displayLabel,
    contractorContactEmail: contractor.contactEmail,
    contractValue,
    sections: sections.map(s => ({
      sectionNo: s.sectionNo, title: s.title,
      text: substituteBidderWithContractor(s.text),
    })),
  }
}
