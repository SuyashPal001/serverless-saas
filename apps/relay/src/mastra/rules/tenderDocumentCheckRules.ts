export interface SectionState {
  sectionNo: string;
  present: boolean;
  accepted: boolean;
  hasContent: boolean;
}

export interface StructuralCheckResult {
  ruleId: string;
  sectionNo: string;
  status: 'pass' | 'fail';
  message: string;
}

const REQUIRED_SECTIONS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;

const SECTION_LABELS: Record<string, string> = {
  S1: 'Instructions to Bidders', S2: 'Eligibility / PQ Criteria', S3: 'Scope of Work',
  S4: 'Technical Specifications', S5: 'Special Conditions of Contract', S6: 'Schedule of Rates / BOQ',
  S7: 'Bid Evaluation Criteria', S8: 'Annexures',
};

export function evaluateStructuralChecks(sections: SectionState[]): StructuralCheckResult[] {
  const byNo = new Map(sections.map(s => [s.sectionNo, s]));

  return REQUIRED_SECTIONS.map((sectionNo) => {
    const ruleId = `DC-${sectionNo}`;
    const label = SECTION_LABELS[sectionNo];
    const state = byNo.get(sectionNo);

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
