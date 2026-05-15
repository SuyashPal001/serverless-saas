import type { Step as TaskStep } from '@/types/task'

export type TaskPhase =
  | 'no_plan'
  | 'planning'
  | 'planning_failed'
  | 'execution_failed'
  | 'clarification'
  | 'plan_review'
  | 'execution'
  | 'review'

export function getPhase(
  status: string,
  steps: TaskStep[],
  blockedReason?: string | null
): TaskPhase {
  if (status === 'planning') return 'planning'
  if (status === 'blocked') {
    if (blockedReason?.includes('Planning failed') && steps.length === 0)
      return 'planning_failed'
    const hasFailedStep = steps.some((s: any) => s.status === 'failed')
    if (hasFailedStep) return 'execution_failed'
    return 'clarification'
  }
  if (status === 'awaiting_approval') return 'plan_review'
  if (status === 'ready' || status === 'in_progress') return 'execution'
  if (status === 'review' || status === 'done') return 'review'
  if (steps.length === 0) return 'no_plan'
  const allDone = steps.every(s => s.status === 'done')
  if (allDone) return 'review'
  return 'plan_review'
}
