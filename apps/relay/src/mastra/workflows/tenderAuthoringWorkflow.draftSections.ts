import { createStep } from '@mastra/core/workflows'
import { db, tenders, clauseLibrary } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { tenderAuthorAgent } from '../agents/tenderAuthorAgent.js'
import { extractJsonObject } from '../../tender/tenderAuthoringJson.js'
import type { MandatoryClause, AnnexureSpec } from '../rules/tenderClauseRules.js'
import { clauseRulesStepOutputSchema, draftStepOutputSchema } from './tenderAuthoringWorkflow.schemas.js'

interface PromptArgs {
  tender: { title: string; department: string; budget: string | null }
  templateFields: Record<string, unknown>
  requirementText: string
  libraryText: string
  mandatory: MandatoryClause[]
  annexures: AnnexureSpec[]
}

export function buildAuthoringPrompt({ tender, templateFields, requirementText, libraryText, mandatory, annexures }: PromptArgs): string {
  const jurisdiction = String(templateFields.jurisdiction ?? 'Government of Madhya Pradesh')

  const estimatedValue = tender.budget ? Number(tender.budget) : 0
  const durationMonths = parseInt(String(templateFields.contractDuration ?? '36'), 10) || 36
  const annualValue = estimatedValue > 0 ? estimatedValue / (durationMonths / 12) : 0
  const turnoverThresholdCr = annualValue > 0
    ? `Rs. ${(annualValue / 1e7).toFixed(2)} Crore (= Estimated Value ÷ ${(durationMonths / 12).toFixed(1)} years; MUST use this figure — do not substitute a fixed library amount)`
    : '(derive from estimated value)'
  const similarWorkThresholdCr = estimatedValue > 0
    ? `Rs. ${(estimatedValue * 0.5 / 1e7).toFixed(2)} Crore (= 50% of Estimated Value per CL-002; MUST use this exact figure, written with the numeric crore value first in the threshold cell — do not substitute a library or arbitrary amount)`
    : '(derive from estimated value)'

  const mandatoryBlock = mandatory.length
    ? mandatory.map(m => `- Clause ${m.clauseNo} "${m.title}" (cite libraryRef "${m.libraryRef}"): ${m.reason}`).join('\n')
    : '(none apply to this tender)'

  const annexureBlock = annexures.map(a =>
    `${a.sectionNo} "${a.title}" — paste the full text of library clause "${a.libraryRef}" verbatim as this section's content.text; this is boilerplate, not freshly drafted prose.`
  ).join('\n')

  return `Draft a complete government RFP with the following details.

Title: ${tender.title}
Department: ${tender.department}
Issuing Authority: ${jurisdiction}
Estimated Value: Rs.${tender.budget ?? 'TBD'}
Category: ${templateFields.category ?? 'IT/Software'}
Procurement Mode: ${templateFields.procurementMode ?? 'Two-Bid'}
Contract Duration: ${templateFields.contractDuration ?? '36 months'}
Derived Annual Turnover Threshold for S2: ${turnoverThresholdCr}
Derived Similar-Work Experience Threshold for S2: ${similarWorkThresholdCr}
Key Dates: ${JSON.stringify(templateFields.keyDates ?? {})}

S3 SCOPE INSTRUCTION: In S3 (Scope of Work), enumerate ALL key functional modules listed in the requirement document (including any Annexure listing sub-modules such as Pension/GPF/NPS, payroll, HR modules, etc.) as distinct bullet-style clauses. Each module should be a named clause in the clauses[] array, not buried in the text field.

MANDATORY S8 CLAUSES — these MUST appear in S8's clauses[] array with the exact clauseNo shown, source:"library", and the given libraryRef (do not omit any of these; the system will patch them in if you do, but include them yourself):
${mandatoryBlock}

MANDATORY ANNEXURE SECTIONS — draft these in addition to S1–S8, using blockType "annexure":
${annexureBlock || '(none)'}

Requirement Document:
${requirementText.slice(0, 200000) || '(Draft from title and department context.)'}

Clause library (set source:"library" + libraryRef to the clause code when reusing):
${libraryText || '(None)'}

OUTPUT FORMAT — return ONLY this JSON, no markdown. S7 clauses[] must have ≥5 entries (7.1–7.5). S8 clauses[] must have ≥9 entries (8.1–8.9, plus the mandatory clauses above). Include cvcFlags array ([] if none). Include one annexure-type section per MANDATORY ANNEXURE SECTION listed above.
{"sections":[{"sectionNo":"S1","title":"Notice Inviting Tender & Overview","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"1.1","title":"...","text":"...","source":"drafted","libraryRef":null}]}},{"sectionNo":"S2","title":"Eligibility / Pre-Qualification Criteria","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S3","title":"Scope of Work","blockType":"prose","content":{"text":"...","clauses":[]}},{"sectionNo":"S4","title":"Technical Specifications","blockType":"criteria-table","content":{"rows":[{"criterion":"...","threshold":"...","verification":"...","source":"drafted","libraryRef":null}],"clauses":[]}},{"sectionNo":"S5","title":"Service Levels (SLA / KPI)","blockType":"spec-table","content":{"rows":[{"metric":"...","target":"...","measurement":"..."}],"clauses":[]}},{"sectionNo":"S6","title":"Bill of Quantities","blockType":"line-item-table","content":{"rows":[{"slNo":1,"item":"...","unit":"...","qty":1,"remarks":"..."}],"clauses":[]}},{"sectionNo":"S7","title":"Evaluation Methodology","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"7.1","title":"Bid Opening Sequence","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.2","title":"Technical Qualification","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.3","title":"Financial Evaluation","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.4","title":"Award","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"7.5","title":"QCBS (if applicable)","text":"...","source":"drafted","libraryRef":null}]}},{"sectionNo":"S8","title":"Contract Terms, Compliance & Security","blockType":"prose","content":{"text":"...","clauses":[{"clauseNo":"8.1","title":"Payment Terms","text":"...","source":"library","libraryRef":"CL-013"},{"clauseNo":"8.2","title":"Performance Bank Guarantee","text":"...","source":"library","libraryRef":"CL-015"},{"clauseNo":"8.3","title":"Liquidated Damages","text":"...","source":"library","libraryRef":"CL-014"},{"clauseNo":"8.4","title":"Warranty / AMC","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.5","title":"Security & Compliance","text":"...","source":"library","libraryRef":"CL-016"},{"clauseNo":"8.6","title":"Confidentiality","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.7","title":"Intellectual Property","text":"...","source":"library","libraryRef":"CL-020"},{"clauseNo":"8.8","title":"Termination","text":"...","source":"drafted","libraryRef":null},{"clauseNo":"8.9","title":"Governing Law & Dispute Resolution","text":"...","source":"library","libraryRef":"CL-019"}]}},{"sectionNo":"S9","title":"General Conditions / Terms of Contract","blockType":"annexure","content":{"text":"...","clauses":[]}},{"sectionNo":"S10","title":"Commercial Annexures","blockType":"annexure","content":{"text":"...","clauses":[]}}],"cvcFlags":[{"section":"S2","clauseRef":"2.1","concern":"...","suggestion":"..."}]}`
}

export const draftSectionsStep = createStep({
  id: 'tender-authoring-draft-sections',
  inputSchema: clauseRulesStepOutputSchema,
  outputSchema: draftStepOutputSchema,
  execute: async ({ inputData }) => {
    const { tenderId, tenantId, mandatory, annexures } = inputData

    const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId))
    if (!tender) throw new Error(`tender not found: ${tenderId}`)

    const libraryRows = await db.select().from(clauseLibrary)
      .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)))
    const libraryText = libraryRows.map(cl => `${cl.code} [${cl.category}] "${cl.title}": ${cl.content}`).join('\n')
    const templateFields = (tender.templateFields ?? {}) as Record<string, unknown>
    const requirementText = tender.requirementText ?? ''

    const agentResult = await tenderAuthorAgent.generate(
      buildAuthoringPrompt({ tender, templateFields, requirementText, libraryText, mandatory, annexures })
    )
    const agentText = (agentResult.text ?? '').trim()
    const rawParsed = JSON.parse(extractJsonObject(agentText))
    const sections: unknown[] = Array.isArray(rawParsed)
      ? rawParsed
      : Array.isArray(rawParsed?.sections)
        ? rawParsed.sections
        : Array.isArray(rawParsed?.rfp?.sections)
          ? rawParsed.rfp.sections
          : []
    if (!sections.length) throw new Error(`Model returned 0 sections. Preview: ${agentText.slice(0, 200)}`)

    const cvcFlags: unknown[] = Array.isArray(rawParsed?.cvcFlags) ? rawParsed.cvcFlags : []

    return { tenderId, tenantId, mandatory, annexures, sections, cvcFlags }
  },
})
