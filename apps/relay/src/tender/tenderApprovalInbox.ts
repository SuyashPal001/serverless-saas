// apps/relay/src/tender/tenderApprovalInbox.ts
import { db, tenderApprovalSteps, tenders } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { canActOnStep, type ApprovalStepState } from './tenderApprovalChain.js'

export interface PendingApprovalItem {
  stepId: string; tenderId: string; rfpNumber: string
  resourceType: string; resourceId: string; stepOrder: number; createdAt: Date
}

export async function getPendingApprovalsForRole(tenantId: string, approverRole: string): Promise<PendingApprovalItem[]> {
  const candidateSteps = await db.select().from(tenderApprovalSteps).where(
    and(eq(tenderApprovalSteps.tenantId, tenantId), eq(tenderApprovalSteps.approverRole, approverRole), eq(tenderApprovalSteps.status, 'pending'))
  )
  if (!candidateSteps.length) return []

  const results: PendingApprovalItem[] = []
  const chainCache: Map<string, ApprovalStepState[]> = new Map()

  for (const candidate of candidateSteps) {
    const chainKey = `${candidate.resourceType}:${candidate.resourceId}`
    let chain: ApprovalStepState[] | undefined = chainCache.get(chainKey)
    if (!chain) {
      const allStepsForResource = await db.select().from(tenderApprovalSteps).where(
        and(
          eq(tenderApprovalSteps.tenantId, tenantId), eq(tenderApprovalSteps.resourceType, candidate.resourceType),
          eq(tenderApprovalSteps.resourceId, candidate.resourceId),
        )
      )
      chain = allStepsForResource.map((s: any) => ({ stepOrder: s.stepOrder, approverRole: s.approverRole, status: s.status })) as ApprovalStepState[]
      chainCache.set(chainKey, chain)
    }
    if (!canActOnStep(chain!, candidate.stepOrder)) continue

    const [tender] = await db.select({ rfpNumber: tenders.rfpNumber }).from(tenders).where(
      and(eq(tenders.id, candidate.tenderId), eq(tenders.tenantId, tenantId))
    )
    results.push({
      stepId: candidate.id, tenderId: candidate.tenderId, rfpNumber: tender?.rfpNumber ?? '',
      resourceType: candidate.resourceType, resourceId: candidate.resourceId,
      stepOrder: candidate.stepOrder, createdAt: candidate.createdAt,
    })
  }

  return results
}
