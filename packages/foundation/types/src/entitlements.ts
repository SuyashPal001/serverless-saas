import type { Timestamps, SoftDeletable } from './common';
import type { Plan, FeatureType, FeatureResetPeriod, FeatureStatus } from './enums';

// ============================================
// Feature
// ============================================

export interface Feature extends Timestamps {
  id: string;
  key: string;
  name: string;
  type: FeatureType;
  description: string | null;
  unit: string | null;
  resetPeriod: FeatureResetPeriod | null;
  metricKey: string | null;
  status: FeatureStatus;
}

// ============================================
// Plan Entitlement
// ============================================

export interface PlanEntitlement extends Timestamps {
  id: string;
  plan: Plan;
  featureId: string;
  enabled: boolean;
  valueLimit: number | null;
  unlimited: boolean;
}

// ============================================
// Tenant Feature Override
// ============================================

export interface TenantFeatureOverride extends Timestamps, SoftDeletable {
  id: string;
  tenantId: string;
  featureId: string;
  enabled: boolean | null;
  valueLimit: number | null;
  unlimited: boolean | null;
  reason: string | null;
  grantedBy: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

// ============================================
// Resolved Entitlement (used by middleware)
// ============================================

export interface ResolvedBooleanEntitlement {
  type: 'boolean';
  enabled: boolean;
  source: 'plan' | 'override';
}

export interface ResolvedLimitEntitlement {
  type: 'limit';
  limit: number;
  unlimited: boolean;
  current: number;
  source: 'plan' | 'override';
}

export interface ResolvedMeteredEntitlement {
  type: 'metered';
  limit: number;
  unlimited: boolean;
  used: number;
  source: 'plan' | 'override';
  expiresAt?: Date;
}

export type ResolvedEntitlement =
  | ResolvedBooleanEntitlement
  | ResolvedLimitEntitlement
  | ResolvedMeteredEntitlement;

export type EntitlementSet = Record<string, ResolvedEntitlement>;
