import { db } from './src/client';
import { users } from './src/schema/auth';
import { memberships } from './src/schema/tenancy';
import { subscriptions } from './src/schema/billing';

async function main() {
  const u = await db.select().from(users);
  console.log('users:', JSON.stringify(u, null, 2));

  const m = await db.select().from(memberships);
  console.log('memberships:', JSON.stringify(m, null, 2));

  const s = await db.select().from(subscriptions);
  console.log('subscriptions:', JSON.stringify(s, null, 2));

  process.exit(0);
}

main().catch(console.error);
