import { eq, and, or, isNull, inArray } from 'drizzle-orm';
import type { DB } from '../db';
import { memberships, roles, rolePermissions, permissions } from '@serverless-saas/database';

export async function resolveRecipientsByPermission(
  db: DB,
  tenantId: string,
  permission: string,
): Promise<string[]> {
  const [resource, action] = permission.split(':');
  if (!resource || !action) {
    console.log('Invalid permission string format', { permission });
    return [];
  }

  // Find all role IDs that have the target permission — include system roles (tenantId IS NULL)
  const matchingRoles = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(permissions.resource, resource),
        eq(permissions.action, action as 'create' | 'read' | 'update' | 'delete'),
        or(isNull(roles.tenantId), eq(roles.tenantId, tenantId)),
      ),
    );

  if (matchingRoles.length === 0) return [];

  const roleIds = matchingRoles.map((r: { roleId: string }) => r.roleId);

  // Single query for all matching members
  const members = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        inArray(memberships.roleId, roleIds),
        eq(memberships.memberType, 'human'),
        eq(memberships.status, 'active'),
      ),
    );

  return members
    .map((r: { userId: string | null }) => r.userId)
    .filter((id: string | null): id is string => id !== null);
}
