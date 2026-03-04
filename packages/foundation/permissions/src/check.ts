import type { PermissionSet, PermissionAction, PermissionString } from '@serverless-saas/types';

/**
 * Check if a permission set includes a specific resource:action pair
 */
export const hasPermission = (
  permissions: PermissionSet,
  resource: string,
  action: PermissionAction,
): boolean => {
  return permissions.some((p) => p.resource === resource && p.action === action);
};

/**
 * Check if a permission set includes ALL of the required permissions
 */
export const hasAllPermissions = (
  permissions: PermissionSet,
  required: Array<{ resource: string; action: PermissionAction }>,
): boolean => {
  return required.every((r) => hasPermission(permissions, r.resource, r.action));
};

/**
 * Check if a permission set includes ANY of the required permissions
 */
export const hasAnyPermission = (
  permissions: PermissionSet,
  required: Array<{ resource: string; action: PermissionAction }>,
): boolean => {
  return required.some((r) => hasPermission(permissions, r.resource, r.action));
};

/**
 * Parse a permission string "resource:action" into its parts
 */
export const parsePermissionString = (
  permission: PermissionString,
): { resource: string; action: PermissionAction } => {
  const [resource, action] = permission.split(':');
  if (!resource || !action) {
    throw new Error(`Invalid permission string: ${permission}`);
  }
  return { resource, action: action as PermissionAction };
};

/**
 * Format a resource and action into a permission string
 */
export const toPermissionString = (resource: string, action: PermissionAction): PermissionString => {
  return `${resource}:${action}` as PermissionString;
};

/**
 * Convert a PermissionSet to an array of permission strings
 */
export const toPermissionStrings = (permissions: PermissionSet): PermissionString[] => {
  return permissions.map((p) => toPermissionString(p.resource, p.action));
};

/**
 * Convert an array of permission strings to a PermissionSet
 */
export const fromPermissionStrings = (strings: PermissionString[]): PermissionSet => {
  return strings.map(parsePermissionString);
};
