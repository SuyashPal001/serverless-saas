import { eq, and, isNull } from 'drizzle-orm';
import { roles } from '../schema/index';
import type { db as DB } from './index';

const SYSTEM_ROLES = [
    { name: 'owner', description: 'Full control over tenant', isDefault: true, isAgentRole: false },
    { name: 'admin', description: 'Manage members, billing, settings', isDefault: true, isAgentRole: false },
    { name: 'member', description: 'Standard access to product features', isDefault: true, isAgentRole: false },
    { name: 'ops-agent', description: 'Platform-provisioned ops agent', isDefault: true, isAgentRole: true },
    { name: 'custom-agent', description: 'Tenant-defined agent role baseline', isDefault: false, isAgentRole: true },
] as const;

export async function seedRoles(db: typeof DB) {
    console.log('seeding system-roles');

    for (const r of SYSTEM_ROLES) {
        const existing = await db
            .select({ id: roles.id })
            .from(roles)
            .where(and(eq(roles.name, r.name), isNull(roles.tenantId)))
            .limit(1);

        if (existing.length > 0) {
            console.log(`  skip ${r.name}`);
            continue;
        }

        await db.insert(roles).values({ ...r, tenantId: null });
        console.log(`  inserted ${r.name}`);
    }
}