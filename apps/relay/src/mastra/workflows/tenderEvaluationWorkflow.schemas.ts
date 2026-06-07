import { z } from 'zod'

export const tenderInputSchema = z.object({
  tenderId: z.string(),
  tenantId: z.string(),
})

// PQ step
export const pqBidderSchema = z.object({
  bidderId: z.string(),
  bidderName: z.string(),
  displayLabel: z.string(),
  documentIds: z.array(z.string()).default([]),
})

export const pqResultSchema = z.object({
  bidderId: z.string(),
  bidderName: z.string(),
  displayLabel: z.string(),
  overallStatus: z.enum(['qualified', 'not_qualified', 'cannot_evaluate']),
  findings: z.array(z.object({
    ruleId: z.string(), ruleName: z.string(),
    status: z.enum(['qualified', 'not_qualified', 'cannot_evaluate']),
    provision: z.string(), narration: z.string(),
    declaredValue: z.string().nullable(), thresholdValue: z.string().nullable(),
    sourceDoc: z.string().nullable(), sourcePage: z.number().nullable(),
    findingId: z.string().optional(),
  })),
})

export const pqStepOutputSchema = tenderInputSchema.extend({
  bidders: z.array(pqBidderSchema),
  pqResults: z.array(pqResultSchema),
  qualifiedBidderIds: z.array(z.string()),
})

// Technical step
export const techClauseSchema = z.object({
  clauseNo: z.string(), clauseTitle: z.string(),
  status: z.enum(['complied', 'deviation', 'not_found', 'cannot_evaluate']),
  narration: z.string(),
  rfpRequirement: z.string().optional(),
  bidderResponse: z.string().optional(),
  sourceDoc: z.string().nullable(), sourcePage: z.number().nullable(),
  findingId: z.string().optional(),
})

export const techBidderResultSchema = z.object({
  bidderId: z.string(), bidderName: z.string(), displayLabel: z.string(),
  clauses: z.array(techClauseSchema),
  compliedCount: z.number(), deviationCount: z.number(), notFoundCount: z.number(),
})

export const techStepOutputSchema = pqStepOutputSchema.extend({
  techResults: z.array(techBidderResultSchema),
  liveRunBidderId: z.string().optional(),
})

// Shortfall step
export const shortfallItemSchema = z.object({
  shortfallId: z.string(), bidderId: z.string(), bidderName: z.string(),
  discrepancy: z.string(), sourceDoc: z.string().nullable(), sourcePage: z.number().nullable(),
  clarificationId: z.string().optional(), draftedText: z.string(), status: z.string(),
})

export const shortfallStepOutputSchema = techStepOutputSchema.extend({
  shortfalls: z.array(shortfallItemSchema),
})

// Financial step
export const boqLineSchema = z.object({
  item: z.string(), rfpQty: z.number(), unit: z.string(),
  quotedRate: z.number(), amount: z.number(),
})

export const finBidderResultSchema = z.object({
  bidderId: z.string(), bidderName: z.string(), displayLabel: z.string(),
  boqLines: z.array(boqLineSchema),
  totalAmount: z.number(), arithmeticCorrection: z.number(),
  correctedTotal: z.number(), isL1: z.boolean(), l1Margin: z.number().nullable(),
  sourceDoc: z.string().nullable(), sourcePage: z.number().nullable(),
  findingId: z.string().optional(),
})

export const finStepOutputSchema = shortfallStepOutputSchema.extend({
  finResults: z.array(finBidderResultSchema),
  l1BidderId: z.string(),
  l1Amount: z.number(),
})

// Report step
export const reportStepOutputSchema = finStepOutputSchema.extend({
  reportId: z.string(),
  recommendation: z.string(),
})
