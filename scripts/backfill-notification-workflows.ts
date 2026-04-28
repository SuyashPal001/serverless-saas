import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@serverless-saas/database/schema';
import { tenants } from '@serverless-saas/database/schema/tenancy';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { eq, and, isNull } from 'drizzle-orm';
import { provisionNotificationWorkflows } from '@serverless-saas/database/seeds/notification-workflows';

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log('Backfilling notification workflows for all tenants...');

  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  console.log(`Found ${allTenants.length} tenant(s)`);

  const [ownerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.name, 'owner'), isNull(roles.tenantId)))
    .limit(1);

  if (!ownerRole) {
    throw new Error('System owner role not found — run pnpm db:seed first');
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const tenant of allTenants) {
    const [owner] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(
        eq(memberships.tenantId, tenant.id),
        eq(memberships.roleId, ownerRole.id),
      ))
      .limit(1);

    if (!owner) {
      console.warn(`[SKIP] tenant ${tenant.id} — no owner member found`);
      skipped++;
      continue;
    }

    try {
      await provisionNotificationWorkflows(db, tenant.id, owner.userId);
      console.log(`[OK]   tenant ${tenant.id}`);
      succeeded++;
    } catch (err) {
      console.error(`[FAIL] tenant ${tenant.id}:`, (err as Error).message);
      failed++;
    }
  }

  console.log(`\nDone — ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
}

main()
  .catch(console.error)
  .finally(() => client.end());
