/**
 * Checks if a user has the required permission for a resource and action.
 * Permission format: "resource:action" (e.g., "incidents:create")
 * 
 * @param permissions - Array of permission strings from the user's JWT
 * @param resource - The resource to check (e.g., "incidents")
 * @param action - The action to check (e.g., "create")
 * @returns boolean
 */
export function can(
    permissions: string[] | undefined,
    resource: string,
    action: string
): boolean {
    if (!permissions || !Array.isArray(permissions)) {
        return false;
    }

    const requiredPermission = `${resource}:${action}`;
    return permissions.includes(requiredPermission);
}

export function hasPermission(permissions: string[] | undefined, resource: string, action: string): boolean {
  return can(permissions, resource, action);
}

export function canRead(permissions: string[] | undefined, resource: string): boolean {
  return can(permissions, resource, 'read');
}

export function canCreate(permissions: string[] | undefined, resource: string): boolean {
  return can(permissions, resource, 'create');
}

export function canUpdate(permissions: string[] | undefined, resource: string): boolean {
  return can(permissions, resource, 'update');
}

export function canDelete(permissions: string[] | undefined, resource: string): boolean {
  return can(permissions, resource, 'delete');
}
