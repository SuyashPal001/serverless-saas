import { describe, it, expect } from 'vitest'
import { hasFeature, checkLimit, checkUsage, checkEntitlement } from '../check'
import type { EntitlementSet } from '@serverless-saas/types'

describe('hasFeature', () => {
  it('returns allowed:true when the boolean entitlement is enabled', () => {
    const set: EntitlementSet = {
      branding: { type: 'boolean', enabled: true, source: 'plan' },
    }
    const result = hasFeature(set, 'branding')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('returns allowed:false with reason feature_disabled when disabled', () => {
    const set: EntitlementSet = {
      branding: { type: 'boolean', enabled: false, source: 'plan' },
    }
    const result = hasFeature(set, 'branding')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('feature_disabled')
  })

  it('returns allowed:false with reason feature_not_found for missing key', () => {
    const result = hasFeature({}, 'nonexistent')
    expect(result).toEqual({ allowed: false, reason: 'feature_not_found' })
  })

  it('returns allowed:false with reason wrong_feature_type for a non-boolean', () => {
    const set: EntitlementSet = {
      seats: { type: 'limit', limit: 5, unlimited: false, current: 1, source: 'plan' },
    }
    const result = hasFeature(set, 'seats')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('wrong_feature_type')
  })
})

describe('checkLimit', () => {
  it('returns allowed:false with reason limit_reached when current equals limit', () => {
    const set: EntitlementSet = {
      seats: { type: 'limit', limit: 5, unlimited: false, current: 5, source: 'plan' },
    }
    const result = checkLimit(set, 'seats')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('limit_reached')
  })

  it('returns allowed:true when current is below the limit', () => {
    const set: EntitlementSet = {
      seats: { type: 'limit', limit: 5, unlimited: false, current: 4, source: 'plan' },
    }
    expect(checkLimit(set, 'seats').allowed).toBe(true)
  })

  it('returns allowed:true when unlimited is true regardless of current', () => {
    const set: EntitlementSet = {
      seats: { type: 'limit', limit: 0, unlimited: true, current: 9999, source: 'plan' },
    }
    expect(checkLimit(set, 'seats').allowed).toBe(true)
  })
})

describe('checkUsage', () => {
  it('returns allowed:false with reason quota_exceeded when used >= limit', () => {
    const set: EntitlementSet = {
      messages: { type: 'metered', limit: 100, unlimited: false, used: 100, source: 'plan' },
    }
    const result = checkUsage(set, 'messages')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('quota_exceeded')
  })

  it('returns allowed:true when unlimited', () => {
    const set: EntitlementSet = {
      messages: { type: 'metered', limit: 100, unlimited: true, used: 999, source: 'plan' },
    }
    expect(checkUsage(set, 'messages').allowed).toBe(true)
  })
})

describe('checkEntitlement', () => {
  it('dispatches to hasFeature for boolean type', () => {
    const set: EntitlementSet = {
      branding: { type: 'boolean', enabled: true, source: 'plan' },
    }
    expect(checkEntitlement(set, 'branding').allowed).toBe(true)
  })

  it('dispatches to checkLimit for limit type', () => {
    const set: EntitlementSet = {
      seats: { type: 'limit', limit: 3, unlimited: false, current: 3, source: 'plan' },
    }
    expect(checkEntitlement(set, 'seats').allowed).toBe(false)
  })

  it('returns unknown_feature_type for an unrecognised type', () => {
    // Cast to bypass TS — simulates a DB row with an unexpected type value
    const set = { x: { type: 'custom' as 'boolean', source: 'plan', enabled: true } } as EntitlementSet
    ;(set.x as any).type = 'custom'
    expect(checkEntitlement(set, 'x')).toEqual({ allowed: false, reason: 'unknown_feature_type' })
  })
})
