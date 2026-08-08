export interface PublishGateResult {
  blocked: boolean
  overridden: boolean
  failCount: number
}

export function evaluatePublishGate(
  checks: Array<{ status: 'pass' | 'fail' | 'flagged' }>,
  override: boolean
): PublishGateResult {
  const failCount = checks.filter(c => c.status === 'fail').length
  const hasFailure = failCount > 0

  if (!hasFailure) return { blocked: false, overridden: false, failCount: 0 }
  if (override) return { blocked: false, overridden: true, failCount }
  return { blocked: true, overridden: false, failCount }
}
