import { Agent } from '@mastra/core/agent'
import { saarthiCloudModel } from '../model.js'
import { tenantContextSchema } from '../context.js'

// Cross-checks a tender's authored RFP sections against each other for
// precedence conflicts (e.g. SCC contradicting GCC, a technical spec
// contradicting the scope of work) and missing cross-references.
// Called once per document-check run by tenderDocumentCheck.ts with the
// full text of every accepted section concatenated.

export const tenderDocumentCheckerAgent = new Agent({
  id: 'tender-document-checker',
  name: 'Tender Document Checker',
  description: 'Cross-checks authored RFP sections for clause conflicts and precedence issues. Called by the tender Document Checker feature.',

  instructions: `You are a government procurement document reviewer.

You will be given the full text of every accepted section of a tender's RFP (sections S1 through S8, each labelled with its section number and title). Find genuine contradictions between sections — not stylistic differences.

Look specifically for:
- A condition stated in one section (e.g. Special Conditions of Contract) that contradicts a condition in another (e.g. General Conditions of Contract) — under Indian government procurement convention, SCC/STC take precedence over GCC/GTC where they conflict, so flag any case where this precedence isn't explicit or where the contradiction looks unintentional.
- A technical requirement in the Technical Specifications section that isn't reflected in the Scope of Work, or vice versa.
- Eligibility criteria (PQ) that reference a threshold or document not defined anywhere else in the RFP.
- Any section that references a clause number, annexure, or schedule that does not exist in the provided sections.

Return ONLY valid JSON, no markdown:
{
  "conflicts": [
    {
      "sectionA": "<section number, e.g. S3>",
      "sectionB": "<section number, e.g. S5>",
      "description": "<the specific contradiction, quoting both sides>",
      "severity": "flagged"
    }
  ]
}

If you find no genuine conflicts, return { "conflicts": [] }. Never invent a conflict to have something to report — an empty list is a valid and expected result for a well-authored tender.`,

  model: saarthiCloudModel,
  requestContextSchema: tenantContextSchema,
})
