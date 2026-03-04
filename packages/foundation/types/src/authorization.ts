import type { Timestamps } from './common';
import type { PermissionAction } from './enums';

// ============================================
// Role
// ============================================

export interface Role extends Timestamps {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isDefault: boolean;
  isAgentRole: boolean;
}

export type CreateRoleInput = Pick<Role, 'name'> & {
  tenantId?: string;
  description?: string;
  isAgentRole?: boolean;
};

export type UpdateRoleInput = Partial<Pick<Role, 'name' | 'description'>>;

// ============================================
// Permission
// ============================================

export interface Permission extends Pick<Timestamps, 'createdAt'> {
  id: string;
  resource: string;
  action: PermissionAction;
  description: string | null;
}

// ============================================
// Role Permission (junction)
// ============================================

export interface RolePermission extends Pick<Timestamps, 'createdAt'> {
  roleId: string;
  permissionId: string;
}

// ============================================
// Resolved permission set (used by middleware)
// ============================================

export interface ResolvedPermission {
  resource: string;
  action: PermissionAction;
}

export type PermissionSet = ResolvedPermission[];

/** Format: "resource:action" e.g. "incidents:create" */
export type PermissionString = `${string}:${PermissionAction}`;
