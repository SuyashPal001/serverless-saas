import type { Plan, TenantStatus, MemberType } from './enums';
import type { PermissionSet } from './authorization';
import type { EntitlementSet } from './entitlements';

// ============================================
// JWT Claims (from Cognito Pre Token Generation)
// ============================================

export interface JwtClaims {
  sub: string;
  email: string;
  'custom:tenantId': string;
  'custom:role': string;
  'custom:plan': string;
  jti: string;
  iat: number;
  exp: number;
}

// ============================================
// Request Context (built by middleware chain)
// ============================================

export interface RequestContext {
  user: RequestUser;
  tenant: RequestTenant;
  session: RequestSession;
  permissions: PermissionSet;
  entitlements: EntitlementSet;
  traceId: string;
}

export interface RequestUser {
  id: string;
  cognitoId: string;
  email: string;
  membershipId: string;
  roleId: string;
  memberType: MemberType;
}

export interface RequestTenant {
  id: string;
  slug: string;
  status: TenantStatus;
  plan: Plan;
}

export interface RequestSession {
  jwtId: string;
  expiresAt: Date;
}

// ============================================
// API Key Context (for programmatic access)
// ============================================

export interface ApiKeyContext {
  keyId: string;
  tenantId: string;
  type: string;
  permissions: string[];
}

// ============================================
// Auth Context (union — either user or API key)
// ============================================

export type AuthContext =
  | { type: 'user'; context: RequestContext }
  | { type: 'apikey'; context: ApiKeyContext };
