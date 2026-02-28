import type { PermissionSet, PermissionAction } from '@serverless-saas/types';
import { hasPermission, hasAllPermissions } from './check';

export interface PermissionCheckResult {
  allowed: boolean;
  missing?: Array<{ resource: string; action: PermissionAction }>;
}

/**
 * Check a single permission against the resolved set.
 * Used by middleware to gate route access.
 */
export const checkRoutePermission = (
  permissions: PermissionSet,
  resource: string,
  action: PermissionAction,
): PermissionCheckResult => {
  const allowed = hasPermission(permissions, resource, action);
  return {
    allowed,
    missing: allowed ? undefined : [{ resource, action }],
  };
};

/**
 * Check multiple permissions (ALL required).
 * Used for routes that need compound access.
 */
export const checkRoutePermissions = (
  permissions: PermissionSet,
  required: Array<{ resource: string; action: PermissionAction }>,
): PermissionCheckResult => {
  const allowed = hasAllPermissions(permissions, required);
  if (allowed) return { allowed };

  const missing = required.filter(
    (r) => !hasPermission(permissions, r.resource, r.action),
  );
  return { allowed, missing };
};

/**
 * Helper to create a permission requirement for route definitions.
 */
export const requirePermission = (
  resource: string,
  action: PermissionAction,
): { resource: string; action: PermissionAction } => ({
  resource,
  action,
});
