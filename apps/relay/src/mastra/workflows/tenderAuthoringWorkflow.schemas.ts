import { z } from 'zod'

export const authoringInputSchema = z.object({
  tenderId: z.string(),
  tenantId: z.string(),
})

export const mandatoryClauseSchema = z.object({
  clauseNo: z.string(),
  libraryRef: z.string(),
  title: z.string(),
  reason: z.string(),
})

export const annexureSpecSchema = z.object({
  sectionNo: z.string(),
  title: z.string(),
  libraryRef: z.string(),
})

export const clauseRulesStepOutputSchema = authoringInputSchema.extend({
  mandatory: z.array(mandatoryClauseSchema),
  annexures: z.array(annexureSpecSchema),
})

export const rfpSectionSchema = z.object({
  sectionNo: z.string(),
  title: z.string(),
  blockType: z.string(),
  content: z.record(z.any()),
})

export const draftStepOutputSchema = clauseRulesStepOutputSchema.extend({
  sections: z.array(rfpSectionSchema),
  cvcFlags: z.array(z.record(z.any())),
})

export const enforceStepOutputSchema = draftStepOutputSchema

export const saveStepOutputSchema = authoringInputSchema.extend({
  sectionCount: z.number(),
})
