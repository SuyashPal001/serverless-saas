import { describe, it, expect } from 'vitest';
import { buildContractContent, substituteBidderWithContractor, type ContractContentInput } from '../tenderContractContent.js';

describe('substituteBidderWithContractor', () => {
  it('replaces standalone "bidder" preserving lowercase', () => {
    expect(substituteBidderWithContractor('the bidder shall deliver')).toBe('the contractor shall deliver');
  });

  it('replaces capitalized "Bidder" preserving capitalization', () => {
    expect(substituteBidderWithContractor('Bidder shall deliver')).toBe('Contractor shall deliver');
  });

  it('replaces all-caps "BIDDER" preserving all-caps', () => {
    expect(substituteBidderWithContractor('THE BIDDER IS RESPONSIBLE')).toBe('THE CONTRACTOR IS RESPONSIBLE');
  });

  it('replaces the plural "bidders"/"Bidders" correctly, not as "contractors" mangled from singular replacement', () => {
    expect(substituteBidderWithContractor('bidders shall submit')).toBe('contractors shall submit');
    expect(substituteBidderWithContractor('Bidders shall submit')).toBe('Contractors shall submit');
  });

  it('does not touch unrelated words containing "bidder" as a substring', () => {
    expect(substituteBidderWithContractor('the outbidder wins')).toBe('the outbidder wins');
  });

  it('leaves text with no "bidder" occurrences unchanged', () => {
    expect(substituteBidderWithContractor('Payment due within 30 days')).toBe('Payment due within 30 days');
  });
});

const baseInput: ContractContentInput = {
  tender: { rfpNumber: 'MP-DIT/HRMS/2024-25/001', title: 'HRMS Procurement', department: 'Dept of IT' },
  contractor: { id: 'b1', name: 'InfraVision Technologies', displayLabel: 'Bidder A', contactEmail: 'contact@infravision.example' },
  contractValue: 78200000,
  sections: [
    { sectionNo: 'S3', title: 'Scope of Work', text: 'The Bidder shall implement the HRMS system within 12 months.' },
    { sectionNo: 'S5', title: 'Service Levels (SLA / KPI)', text: 'The bidder shall maintain 99.5% uptime.' },
  ],
};

describe('buildContractContent', () => {
  it('carries contractor identity fields through unchanged', () => {
    const content = buildContractContent(baseInput);
    expect(content.contractorName).toBe('InfraVision Technologies');
    expect(content.contractorDisplayLabel).toBe('Bidder A');
    expect(content.contractorContactEmail).toBe('contact@infravision.example');
    expect(content.contractValue).toBe(78200000);
  });

  it('applies bidder→contractor substitution to every section\'s text', () => {
    const content = buildContractContent(baseInput);
    const scope = content.sections.find(s => s.sectionNo === 'S3')!;
    expect(scope.text).toBe('The Contractor shall implement the HRMS system within 12 months.');
    const sla = content.sections.find(s => s.sectionNo === 'S5')!;
    expect(sla.text).toBe('The contractor shall maintain 99.5% uptime.');
  });

  it('preserves section order and titles from input', () => {
    const content = buildContractContent(baseInput);
    expect(content.sections.map(s => s.sectionNo)).toEqual(['S3', 'S5']);
    expect(content.sections[0].title).toBe('Scope of Work');
  });

  it('handles a contractor with no contact email', () => {
    const content = buildContractContent({ ...baseInput, contractor: { ...baseInput.contractor, contactEmail: null } });
    expect(content.contractorContactEmail).toBeNull();
  });

  it('handles zero source sections without throwing', () => {
    const content = buildContractContent({ ...baseInput, sections: [] });
    expect(content.sections).toEqual([]);
  });
});
