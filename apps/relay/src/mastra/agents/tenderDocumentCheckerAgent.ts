import { Agent } from '@mastra/core/agent'
import { saarthiCloudModel } from '../model.js'
import { tenantContextSchema } from '../context.js'

// Cross-checks a tender's authored RFP sections against each other for
// consistency conflicts (e.g. Technical Specifications contradicting Scope
// of Work, SLA targets referencing undefined deliverables) and missing
// cross-references.
// Called once per document-check run by tenderDocumentCheck.ts with the
// full text of every accepted section concatenated.

export const tenderDocumentCheckerAgent = new Agent({
  id: 'tender-document-checker',
  name: 'Tender Document Checker',
  description: 'Cross-checks authored RFP sections for clause conflicts and precedence issues. Called by the tender Document Checker feature.',

  instructions: `You are a government procurement document reviewer.

You will be given the full text of every accepted section of a tender's RFP. This system's RFPs always follow the same 8-section structure:
S1 Notice Inviting Tender & Overview, S2 Eligibility / Pre-Qualification Criteria, S3 Scope of Work,
S4 Technical Specifications, S5 Service Levels (SLA / KPI), S6 Bill of Quantities,
S7 Evaluation Methodology, S8 Contract Terms, Compliance & Security.
Find genuine contradictions between sections — not stylistic differences.

Look specifically for:
- A functional module, deliverable, or scope item enumerated in Scope of Work (S3) that has no corresponding line item in the Bill of Quantities (S6), or a BOQ line item that isn't grounded in anything described in S3.
- A requirement or standard stated in Technical Specifications (S4) that isn't reflected in Scope of Work (S3), or vice versa — e.g. a technical criterion the scope never asks for, or scope work with no matching spec.
- An SLA/KPI target in Service Levels (S5) that references a deliverable, module, or metric not defined anywhere in Scope of Work (S3) or Technical Specifications (S4).
- Eligibility / Pre-Qualification criteria (S2) that reference a threshold, document, or experience requirement not consistent with the scale of work described in Scope of Work (S3) or the contract terms in S8 (e.g. a turnover threshold or duration mismatch).
- A payment term, penalty, or liquidated-damages clause in Contract Terms (S8) that contradicts an SLA/KPI target or measurement basis in Service Levels (S5).
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
