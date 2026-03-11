import { eq, and, isNull } from 'drizzle-orm';
import { roles, permissions, rolePermissions } from '../schema/index';
import { RESOURCES } from './permissions';
import type { db as DB } from './index';

const ALL_PERMS = Object.entries(RESOURCES).flatMap(
    ([res, actions]) => actions.map((a) => `${res}:${a}`)
);

const ROLE_PERMISSIONS: Record<string, string[]> = {
    owner: ALL_PERMS,

    admin: ALL_PERMS.filter(
        (p) =>
            p !== 'tenant:delete' &&
            p !== 'entitlements:create' &&
            p !== 'entitlements:update' &&
            p !== 'entitlements:delete'
    ),

    member: [
        'members:read',
        'roles:read',
        'api-keys:create',
        'api-keys:read',
        'api-keys:delete',
        'notifications:read',
        'notifications:update',
        'audit:read',
        'tenant:read',
        'agent-runs:read',
        'integrations:read',
    ],

    'ops-agent': [
        'members:read',
        'roles:read',
        'billing:read',
        'invoices:read',
        'subscriptions:read',
        'api-keys:read',
        'agents:read',
        'agent-workflows:read',
        'agent-workflows:create',
        'agent-runs:read',
        'agent-runs:delete',
        'audit:read',
        'tenant:read',
        'notifications:read',
        'integrations:read',
    ],

    'custom-agent': [
        'members:read',
        'roles:read',
        'billing:read',
        'invoices:read',
        'subscriptions:read',
        'api-keys:read',
        'agents:read',
        'agent-workflows:read',
        'agent-workflows:create',
        'agent-runs:read',
        'agent-runs:delete',
        'audit:read',
        'tenant:read',
        'notifications:read',
        'integrations:read',
    ],
};

export async function seedRolePermissions(db: typeof DB) {
    console.log('seeding role-permissions');

    for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
        const [role] = await db
            .select({ id: roles.id })
            .from(roles)
            .where(and(eq(roles.name, roleName), isNull(roles.tenantId)))
            .limit(1);

        if (!role) {
            console.log(`  role not found: ${roleName}`);
            continue;
        }

        let created = 0;
        let skipped = 0;

        for (const key of permKeys) {
            const [resource, action] = key.split(':');

            const [perm] = await db
                .select({ id: permissions.id })
                .from(permissions)
                .where(and(eq(permissions.resource, resource), eq(permissions.action, action as any)))
                .limit(1);

            if (!perm) {
                console.log(`  permission not found: ${key}`);
                continue;
            }

            const existing = await db
                .select({ roleId: rolePermissions.roleId })
                .from(rolePermissions)
                .where(
                    and(
                        eq(rolePermissions.roleId, role.id),
                        eq(rolePermissions.permissionId, perm.id)
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                skipped++;
                continue;
            }

            await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id });
            created++;
        }

        console.log(`  ${roleName}: inserted ${created}, skipped ${skipped}`);
    }
}