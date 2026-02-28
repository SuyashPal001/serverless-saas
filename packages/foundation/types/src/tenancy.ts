import type { Timestamps, SoftDeletable } from './common';
import type { TenantType, TenantStatus, MemberType, MembershipStatus } from './enums';

// ============================================
// Tenant
// ============================================

export interface Tenant extends Timestamps, SoftDeletable {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
  status: TenantStatus;
}

export type CreateTenantInput = Pick<Tenant, 'name' | 'slug' | 'type'>;

export type UpdateTenantInput = Partial<Pick<Tenant, 'name' | 'type'>>;

// ============================================
// Membership
// ============================================

export interface Membership extends Timestamps {
  id: string;
  userId: string | null;
  agentId: string | null;
  tenantId: string;
  roleId: string;
  memberType: MemberType;
  status: MembershipStatus;
  invitedBy: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
}

export type CreateMembershipInput = Pick<Membership, 'tenantId' | 'roleId' | 'memberType'> & {
  userId?: string;
  agentId?: string;
  invitedBy?: string;
};

export type UpdateMembershipInput = Partial<Pick<Membership, 'roleId' | 'status'>>;
