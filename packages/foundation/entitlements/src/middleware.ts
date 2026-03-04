import type { EntitlementSet } from '@serverless-saas/types';
import { checkEntitlement, hasFeature, checkLimit, checkUsage } from './check';
import type { EntitlementCheckResult } from './check';

export interface FeatureGateResult {
  allowed: boolean;
  denied: Array<{
    featureKey: string;
    reason: string;
  }>;
}

/**
 * Gate a route behind a single feature check
 */
export const gateFeature = (
  entitlements: EntitlementSet,
  featureKey: string,
): EntitlementCheckResult => {
  return checkEntitlement(entitlements, featureKey);
};

/**
 * Gate a route behind multiple feature checks (ALL must pass)
 */
export const gateFeatures = (
  entitlements: EntitlementSet,
  featureKeys: string[],
): FeatureGateResult => {
  const denied: FeatureGateResult['denied'] = [];

  for (const key of featureKeys) {
    const result = checkEntitlement(entitlements, key);
    if (!result.allowed) {
      denied.push({ featureKey: key, reason: result.reason ?? 'denied' });
    }
  }

  return {
    allowed: denied.length === 0,
    denied,
  };
};

/**
 * Helper to define feature requirements for route definitions
 */
export const requireFeature = (featureKey: string): string => featureKey;

/**
 * Re-export check functions for convenience
 */
export { hasFeature, checkLimit, checkUsage, checkEntitlement };
