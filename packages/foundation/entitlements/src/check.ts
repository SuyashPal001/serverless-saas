import type {
  ResolvedEntitlement,
  ResolvedBooleanEntitlement,
  ResolvedLimitEntitlement,
  ResolvedMeteredEntitlement,
  EntitlementSet,
} from '@serverless-saas/types';

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  entitlement?: ResolvedEntitlement;
}

/**
 * Check if a boolean feature is enabled
 */
export const hasFeature = (
  entitlements: EntitlementSet,
  featureKey: string,
): EntitlementCheckResult => {
  const entitlement = entitlements[featureKey];
  if (!entitlement) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  if (entitlement.type !== 'boolean') {
    return { allowed: false, reason: 'wrong_feature_type', entitlement };
  }

  const boolEntitlement = entitlement as ResolvedBooleanEntitlement;
  return {
    allowed: boolEntitlement.enabled,
    reason: boolEntitlement.enabled ? undefined : 'feature_disabled',
    entitlement,
  };
};

/**
 * Check if a limit feature has capacity remaining
 */
export const checkLimit = (
  entitlements: EntitlementSet,
  featureKey: string,
): EntitlementCheckResult => {
  const entitlement = entitlements[featureKey];
  if (!entitlement) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  if (entitlement.type !== 'limit') {
    return { allowed: false, reason: 'wrong_feature_type', entitlement };
  }

  const limitEntitlement = entitlement as ResolvedLimitEntitlement;

  if (limitEntitlement.unlimited) {
    return { allowed: true, entitlement };
  }

  const allowed = limitEntitlement.current < limitEntitlement.limit;
  return {
    allowed,
    reason: allowed ? undefined : 'limit_reached',
    entitlement,
  };
};

/**
 * Check if a metered feature has quota remaining
 */
export const checkUsage = (
  entitlements: EntitlementSet,
  featureKey: string,
): EntitlementCheckResult => {
  const entitlement = entitlements[featureKey];
  if (!entitlement) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  if (entitlement.type !== 'metered') {
    return { allowed: false, reason: 'wrong_feature_type', entitlement };
  }

  const meteredEntitlement = entitlement as ResolvedMeteredEntitlement;

  if (meteredEntitlement.unlimited) {
    return { allowed: true, entitlement };
  }

  const allowed = meteredEntitlement.used < meteredEntitlement.limit;
  return {
    allowed,
    reason: allowed ? undefined : 'quota_exceeded',
    entitlement,
  };
};

/**
 * Generic check — dispatches to the right check based on feature type
 */
export const checkEntitlement = (
  entitlements: EntitlementSet,
  featureKey: string,
): EntitlementCheckResult => {
  const entitlement = entitlements[featureKey];
  if (!entitlement) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  switch (entitlement.type) {
    case 'boolean':
      return hasFeature(entitlements, featureKey);
    case 'limit':
      return checkLimit(entitlements, featureKey);
    case 'metered':
      return checkUsage(entitlements, featureKey);
    default:
      return { allowed: false, reason: 'unknown_feature_type' };
  }
};
