export const DEFAULT_APPROVAL_CHAIN = ['Reviewing Officer', 'Approving Authority'] as const

export interface ApprovalStepState {
  stepOrder: number
  approverRole: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface ChainSummary {
  currentStep: ApprovalStepState | null
  isFullyApproved: boolean
  isRejected: boolean
  completedCount: number
  totalCount: number
}

export function buildDefaultChainSteps(roles: readonly string[] = DEFAULT_APPROVAL_CHAIN): { stepOrder: number; approverRole: string }[] {
  return roles.map((approverRole, i) => ({ stepOrder: i + 1, approverRole }))
}

export function summarizeChain(steps: ApprovalStepState[]): ChainSummary {
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const isRejected = sorted.some(s => s.status === 'rejected')
  const isFullyApproved = !isRejected && sorted.length > 0 && sorted.every(s => s.status === 'approved')
  const completedCount = sorted.filter(s => s.status === 'approved').length

  const currentStep = (isRejected || isFullyApproved)
    ? null
    : sorted.find(s => s.status === 'pending') ?? null

  return { currentStep, isFullyApproved, isRejected, completedCount, totalCount: sorted.length }
}

export function canActOnStep(steps: ApprovalStepState[], stepOrder: number): boolean {
  const summary = summarizeChain(steps)
  return summary.currentStep?.stepOrder === stepOrder
}
