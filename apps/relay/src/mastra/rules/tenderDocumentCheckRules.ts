export interface SectionState {
  sectionNo: string;
  present: boolean;
  accepted: boolean;
  hasContent: boolean;
  title?: string;
}

export interface StructuralCheckResult {
  ruleId: string;
  sectionNo: string;
  status: 'pass' | 'fail';
  message: string;
}

const REQUIRED_SECTIONS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;

// Fallback labels used only when a section is genuinely MISSING (so there's no
// row to read a real title from). These mirror the actual S1-S8 taxonomy this
// system's tender authoring workflow generates — see apps/relay/src/routes/tenderAuthoring.ts.
const SECTION_LABELS: Record<string, string> = {
  S1: 'Notice Inviting Tender & Overview', S2: 'Eligibility / Pre-Qualification Criteria', S3: 'Scope of Work',
  S4: 'Technical Specifications', S5: 'Service Levels (SLA / KPI)', S6: 'Bill of Quantities',
  S7: 'Evaluation Methodology', S8: 'Contract Terms, Compliance & Security',
};

export function evaluateStructuralChecks(sections: SectionState[]): StructuralCheckResult[] {
  const byNo = new Map(sections.map(s => [s.sectionNo, s]));

  return REQUIRED_SECTIONS.map((sectionNo) => {
    const ruleId = `DC-${sectionNo}`;
    const state = byNo.get(sectionNo);
    const label = state?.title ?? SECTION_LABELS[sectionNo];

    if (!state || !state.present) {
      return { ruleId, sectionNo, status: 'fail', message: `${label} (${sectionNo}) is missing.` };
    }
    if (!state.accepted) {
      return { ruleId, sectionNo, status: 'fail', message: `${label} (${sectionNo}) is present but not accepted.` };
    }
    if (!state.hasContent) {
      return { ruleId, sectionNo, status: 'fail', message: `${label} (${sectionNo}) is accepted but empty.` };
    }
    return { ruleId, sectionNo, status: 'pass', message: `${label} (${sectionNo}) complete.` };
  });
}
