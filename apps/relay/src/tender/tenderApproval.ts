// apps/relay/src/tender/tenderApproval.ts
import { db, tenderApprovalSteps, tenderContracts } from '@serverless-saas/database'
import { eq, and, asc } from 'drizzle-orm'
import { buildDefaultChainSteps, summarizeChain, canActOnStep, type ApprovalStepState } from './tenderApprovalChain.js'
import { writeTenderAuditLog } from '../mastra/workflows/tenderAuditLog.js'

export async function submitContractForApproval(
  tenderId: string, tenantId: string, contractId: string
): Promise<{ steps: { id: string; stepOrder: number; approverRole: string }[] }> {
  const [contract] = await db.select().from(tenderContracts).where(
    and(eq(tenderContracts.id, contractId), eq(tenderContracts.tenderId, tenderId), eq(tenderContracts.tenantId, tenantId))
  )
  if (!contract) throw new Error('contract not found')

  const existing = await db.select().from(tenderApprovalSteps).where(
    and(
      eq(tenderApprovalSteps.tenantId, tenantId), eq(tenderApprovalSteps.tenderId, tenderId),
      eq(tenderApprovalSteps.resourceType, 'contract'), eq(tenderApprovalSteps.resourceId, contractId),
    )
  ).orderBy(asc(tenderApprovalSteps.stepOrder))

  if (existing.length > 0) {
    return { steps: existing.map(s => ({ id: s.id, stepOrder: s.stepOrder, approverRole: s.approverRole })) }
  }

  const chainSteps = buildDefaultChainSteps()
  const inserted = await db.insert(tenderApprovalSteps).values(
    chainSteps.map(s => ({
      tenantId, tenderId, resourceType: 'contract' as const, resourceId: contractId,
      stepOrder: s.stepOrder, approverRole: s.approverRole,
    }))
  ).returning({ id: tenderApprovalSteps.id, stepOrder: tenderApprovalSteps.stepOrder, approverRole: tenderApprovalSteps.approverRole })

  await writeTenderAuditLog({
    tenantId, actorId: 'system', action: 'approval_submitted', resource: 'tender_contract', resourceId: contractId,
    metadata: { tenderId, stepCount: inserted.length },
  })

  return { steps: inserted.sort((a, b) => a.stepOrder - b.stepOrder) }
}

export async function actOnApprovalStep(
  tenderId: string, tenantId: string, stepId: string,
  input: { action: 'approve' | 'reject'; actorId: string; approverRole: string; comment?: string; signatureRef?: string }
): Promise<{ status: 'approved' | 'rejected'; chainComplete: boolean; resourceFinalized: boolean }> {
  const [step] = await db.select().from(tenderApprovalSteps).where(
    and(eq(tenderApprovalSteps.id, stepId), eq(tenderApprovalSteps.tenderId, tenderId), eq(tenderApprovalSteps.tenantId, tenantId))
  )
  if (!step) throw new Error('approval step not found')

  const allSteps = await db.select().from(tenderApprovalSteps).where(
    and(
      eq(tenderApprovalSteps.tenantId, tenantId), eq(tenderApprovalSteps.tenderId, tenderId),
      eq(tenderApprovalSteps.resourceType, step.resourceType), eq(tenderApprovalSteps.resourceId, step.resourceId),
    )
  )
  const stepStates: ApprovalStepState[] = allSteps.map(s => ({ stepOrder: s.stepOrder, approverRole: s.approverRole, status: s.status }))

  if (!canActOnStep(stepStates, step.stepOrder)) {
    throw new Error('step is not currently actionable — a prior step is still pending, this step is already decided, or the chain is halted')
  }

  const newStatus = input.action === 'approve' ? 'approved' as const : 'rejected' as const
  await db.update(tenderApprovalSteps).set({
    status: newStatus, actorId: input.actorId, comment: input.comment ?? null,
    signatureRef: input.signatureRef ?? null, actionedAt: new Date(),
  }).where(eq(tenderApprovalSteps.id, stepId))

  const updatedStates: ApprovalStepState[] = stepStates.map(s =>
    s.stepOrder === step.stepOrder ? { ...s, status: newStatus } : s
  )
  const summary = summarizeChain(updatedStates)

  let resourceFinalized = false
  if (summary.isFullyApproved && step.resourceType === 'contract') {
    await db.update(tenderContracts).set({ status: 'finalized' }).where(
      and(eq(tenderContracts.id, step.resourceId), eq(tenderContracts.tenantId, tenantId))
    )
    resourceFinalized = true
  }

  await writeTenderAuditLog({
    tenantId, actorId: input.actorId, action: `approval_${newStatus}`, resource: 'tender_approval_step', resourceId: stepId,
    metadata: { tenderId, resourceType: step.resourceType, resourceId: step.resourceId, stepOrder: step.stepOrder, comment: input.comment ?? null, chainComplete: summary.isFullyApproved || summary.isRejected, resourceFinalized },
  })

  return { status: newStatus, chainComplete: summary.isFullyApproved || summary.isRejected, resourceFinalized }
}

export async function getApprovalChain(
  tenderId: string, tenantId: string, resourceType: 'contract', resourceId: string
): Promise<{ steps: unknown[] }> {
  const steps = await db.select().from(tenderApprovalSteps).where(
    and(
      eq(tenderApprovalSteps.tenantId, tenantId), eq(tenderApprovalSteps.tenderId, tenderId),
      eq(tenderApprovalSteps.resourceType, resourceType), eq(tenderApprovalSteps.resourceId, resourceId),
    )
  ).orderBy(asc(tenderApprovalSteps.stepOrder))

  return { steps }
}
