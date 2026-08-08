# Vendor Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Vendor Database" microservice (OIL RFP item #11) — a centralized vendor master with category taxonomy, blacklist enforcement (bidder linking + contract formulation), rate/framework contract tracking, participation history, and a dashboard page.

**Architecture:** A new `vendors` table (the master) plus a nullable `vendorId` FK on the existing `bidders` table, so participation history is a real query instead of a manual log. A new `rateContracts` table for standing agreements. Blacklist enforcement is one pure, unit-tested predicate function (`checkVendorBlacklist`) called from two integration points: a new bidder-vendor linking route, and the existing Order/Contract Formulator's `generateContract` (built this week). One new API route file, one new dashboard page styled after `ClauseLibraryPanel.tsx`, seed data mirroring `tenderClauseSeed.ts`.

**Tech Stack:** Drizzle ORM + Postgres, Hono routes, vitest, Next.js/React — all already in use; no new dependencies.

## Global Constraints

- Work on branch `develop` in `serverless-saas/` — never `master`/`main`.
- Every DB query must filter by `tenantId` (tenancy invariant enforced across the whole codebase).
- No OIL-specific data — category taxonomy and seed vendors are generic (per spec, no OIL vendor extract exists; do not invent names resembling any real company).
- No placeholder code, no TODOs — every step below is complete, runnable code.

---

## Task 1: `vendors` + `rate_contracts` tables, `bidders.vendorId` column

**Files:**
- Create: `packages/foundation/database/schema/vendor.ts`
- Modify: `packages/foundation/database/schema/index.ts` (add `export * from './vendor';` after the existing `export * from './tender-approval';` line)
- Modify: `packages/foundation/database/schema/tender.ts` (add nullable `vendorId` column to the `bidders` table definition)

**Interfaces:**
- Produces: `vendors` table, `vendorCategoryEnum` (`'cpsu'|'spsu'|'mse'|'self_help_group'|'govt_body'|'civil_contractor'|'other'`), `rateContracts` table, `rateContractTypeEnum` (`'limited'|'framework'|'rate'`), `bidders.vendorId` column — consumed by Task 2 (rules), Task 3 (CRUD routes), Task 5 (bidder-linking route), Task 6 (contract-formulation gate), Task 7 (participation/rate-contract routes).

- [ ] **Step 1: Write the schema file**

```typescript
// packages/foundation/database/schema/vendor.ts
import { pgTable, uuid, text, jsonb, timestamp, pgEnum, index, boolean } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';

export const vendorCategoryEnum = pgEnum('vendor_category', [
  'cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other',
]);

export const rateContractTypeEnum = pgEnum('rate_contract_type', ['limited', 'framework', 'rate']);

export const vendors = pgTable('vendors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  category:         vendorCategoryEnum('category').notNull().default('other'),
  countryOfOrigin:  text('country_of_origin'),
  contactEmail:     text('contact_email'),
  contactPhone:     text('contact_phone'),
  isBlacklisted:    boolean('is_blacklisted').notNull().default(false),
  blacklistReason:  text('blacklist_reason'),
  blacklistedAt:    timestamp('blacklisted_at', { withTimezone: true }),
  isOemAuthorized:  boolean('is_oem_authorized').notNull().default(false),
  oemProducts:      text('oem_products'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_vendors_tenant').on(t.tenantId),
}));

export const rateContracts = pgTable('rate_contracts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  vendorId:     uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  contractType: rateContractTypeEnum('contract_type').notNull(),
  terms:        text('terms'),
  pricing:      jsonb('pricing').default('{}'),
  validFrom:    timestamp('valid_from', { withTimezone: true }),
  validTo:      timestamp('valid_to', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  vendorIdx: index('idx_rate_contracts_vendor').on(t.vendorId),
}));
```

- [ ] **Step 2: Export from the schema barrel**

Add to `packages/foundation/database/schema/index.ts` immediately after the `export * from './tender-approval';` line:
```typescript
export * from './vendor';
```

- [ ] **Step 3: Add `vendorId` to the `bidders` table**

In `packages/foundation/database/schema/tender.ts`, find the `bidders` table definition (starts `export const bidders = pgTable('bidders', {`). Add a new nullable column after the existing `contactEmail` field:
```typescript
  vendorId:     uuid('vendor_id'), // nullable — links to vendors.id, added in vendor.ts to avoid a circular import; FK enforced at the DB level via the migration below, not via a Drizzle .references() call here
```
Note: do not add a `.references()` call here — `vendor.ts` cannot import from `tender.ts` and vice versa without a cycle, since `vendor.ts` doesn't need to reference `tenders`. The FK constraint itself is added directly in the migration SQL in Step 4 instead (Drizzle supports this: the column is declared in TS, the FK constraint is raw SQL in the generated migration, which is safe to hand-edit before applying since migrations are reviewed before running per this repo's existing convention).

- [ ] **Step 4: Generate the migration, then hand-add the `bidders.vendor_id` FK constraint**

```bash
cd packages/foundation/database
pnpm exec drizzle-kit generate
```
Expected: a new file `packages/foundation/database/migrations/0050_<name>.sql` creating `vendor_category`, `rate_contract_type` enums, the `vendors` and `rate_contracts` tables, and adding the `vendor_id` column to `bidders` (as a plain nullable uuid column, no FK, since Step 3 didn't declare one).

Open the generated migration file and add this line at the end (after the `bidders` `ADD COLUMN vendor_id` statement, in the same file):
```sql
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL;
```
(`ON DELETE SET NULL` rather than `CASCADE` — deleting a vendor should not delete historical bidder records, it should just unlink them. There is no vendor-delete route in this plan, but the constraint should be correct regardless.)

Read the full generated + hand-edited SQL to confirm it matches Step 1 exactly (column names, enums, indexes) before applying.

```bash
pnpm exec drizzle-kit migrate
```
Expected: migration applies cleanly against `DATABASE_URL` with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/foundation/database/schema/vendor.ts packages/foundation/database/schema/index.ts packages/foundation/database/schema/tender.ts packages/foundation/database/migrations/
git commit -m "feat(vendor): add vendors + rate_contracts tables, bidders.vendorId column"
```

---

## Task 2: Blacklist check — pure function + tests

**Files:**
- Create: `apps/api/src/routes/vendorBlacklist.ts`
- Create: `apps/api/src/routes/__tests__/vendorBlacklist.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB dependency).
- Produces: `checkVendorBlacklist(vendor: {isBlacklisted: boolean; blacklistReason: string | null} | null): {blocked: boolean; reason: string | null}` — consumed by Task 5 (bidder-linking route) and Task 6 (contract-formulation gate).

This lives in `apps/api` (not `apps/relay`) because both call sites that need it — the bidder-linking route (Task 5) and the contract-formulation route trigger (Task 6 modifies relay-side `tenderContract.ts`, but the gate check itself is small enough to duplicate as a plain import since `apps/relay` and `apps/api` are separate deployable packages that do not share a runtime `src` import path across packages in this codebase's existing convention — confirm this is still true by checking whether any existing relay file imports from `apps/api/src/...`; if such cross-package imports already exist elsewhere in this codebase, prefer placing this file in `packages/foundation` instead and adjust Task 6's import accordingly). For this plan, default to creating it once in `apps/api/src/routes/vendorBlacklist.ts` and, in Task 6, creating a second copy at `apps/relay/src/mastra/rules/vendorBlacklist.ts` — small (10 lines), duplicated intentionally rather than adding a cross-package dependency, same tradeoff already accepted elsewhere in this codebase (e.g. `checkKey`/`checkInternalKey` helpers are duplicated per-file rather than shared).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/vendorBlacklist.test.ts
import { describe, it, expect } from 'vitest';
import { checkVendorBlacklist } from '../vendorBlacklist.js';

describe('checkVendorBlacklist', () => {
  it('does not block when no vendor is linked', () => {
    const result = checkVendorBlacklist(null);
    expect(result).toEqual({ blocked: false, reason: null });
  });

  it('does not block a non-blacklisted vendor', () => {
    const result = checkVendorBlacklist({ isBlacklisted: false, blacklistReason: null });
    expect(result).toEqual({ blocked: false, reason: null });
  });

  it('blocks a blacklisted vendor and surfaces the reason', () => {
    const result = checkVendorBlacklist({ isBlacklisted: true, blacklistReason: 'Debarred by CVC order dated 2026-01-15' });
    expect(result).toEqual({ blocked: true, reason: 'Debarred by CVC order dated 2026-01-15' });
  });

  it('blocks a blacklisted vendor with a null reason using a default message', () => {
    const result = checkVendorBlacklist({ isBlacklisted: true, blacklistReason: null });
    expect(result).toEqual({ blocked: true, reason: 'Vendor is blacklisted' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/vendorBlacklist.test.ts`
Expected: FAIL — `Cannot find module '../vendorBlacklist.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/vendorBlacklist.ts

export interface VendorBlacklistInput {
  isBlacklisted: boolean;
  blacklistReason: string | null;
}

export interface VendorBlacklistResult {
  blocked: boolean;
  reason: string | null;
}

export function checkVendorBlacklist(vendor: VendorBlacklistInput | null): VendorBlacklistResult {
  if (!vendor) return { blocked: false, reason: null };
  if (!vendor.isBlacklisted) return { blocked: false, reason: null };
  return { blocked: true, reason: vendor.blacklistReason ?? 'Vendor is blacklisted' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/vendorBlacklist.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/vendorBlacklist.ts apps/api/src/routes/__tests__/vendorBlacklist.test.ts
git commit -m "feat(vendor): blacklist check pure function"
```

---

## Task 3: Vendor CRUD API routes

**Files:**
- Create: `apps/api/src/routes/vendors.ts`
- Modify: `apps/api/src/app.ts` (add import near line 42, add `.route()` call near line 220)

**Interfaces:**
- Consumes: `vendors`, `vendorCategoryEnum` from `@serverless-saas/database`, `auditLog` from `@serverless-saas/database/schema/audit`, same `requestContext`/`userId` pattern as `apps/api/src/routes/tenderAuthoring.ts:27,140`.
- Produces: `GET /vendors` (list, optional `?category=` and `?blacklisted=true|false` query filters), `GET /vendors/:id`, `POST /vendors`, `PATCH /vendors/:id` — consumed by Task 8's web UI.

- [ ] **Step 1: Write the route**

```typescript
// apps/api/src/routes/vendors.ts
import { Hono } from 'hono';
import { db, vendors } from '@serverless-saas/database';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const vendorsRoutes = new Hono<AppEnv>();

const VALID_CATEGORIES = ['cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other'];

// GET /vendors — list, optionally filtered by category and/or blacklist status
vendorsRoutes.get('/', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const category = c.req.query('category');
  const blacklisted = c.req.query('blacklisted');

  const conditions = [eq(vendors.tenantId, tenantId)];
  if (category && VALID_CATEGORIES.includes(category)) {
    conditions.push(eq(vendors.category, category as typeof VALID_CATEGORIES[number]));
  }
  if (blacklisted === 'true') conditions.push(eq(vendors.isBlacklisted, true));
  if (blacklisted === 'false') conditions.push(eq(vendors.isBlacklisted, false));

  const rows = await db.select().from(vendors).where(and(...conditions)).orderBy(vendors.name);
  return c.json({ vendors: rows });
});

// GET /vendors/:id
vendorsRoutes.get('/:id', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  if (!vendor) return c.json({ error: 'not found' }, 404);
  return c.json(vendor);
});

// POST /vendors — create
vendorsRoutes.post('/', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;

  let body: {
    name?: string; category?: string; countryOfOrigin?: string;
    contactEmail?: string; contactPhone?: string;
    isOemAuthorized?: boolean; oemProducts?: string;
  };
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const category = body.category && VALID_CATEGORIES.includes(body.category) ? body.category : 'other';

  const [vendor] = await db.insert(vendors).values({
    tenantId,
    name: body.name.trim(),
    category: category as typeof VALID_CATEGORIES[number],
    countryOfOrigin: body.countryOfOrigin ?? null,
    contactEmail: body.contactEmail ?? null,
    contactPhone: body.contactPhone ?? null,
    isOemAuthorized: body.isOemAuthorized ?? false,
    oemProducts: body.oemProducts ?? null,
  }).returning();

  return c.json(vendor, 201);
});

// PATCH /vendors/:id — update fields, including the blacklist toggle
vendorsRoutes.patch('/:id', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const id = c.req.param('id');

  const [existing] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  if (!existing) return c.json({ error: 'not found' }, 404);

  let body: {
    name?: string; category?: string; countryOfOrigin?: string;
    contactEmail?: string; contactPhone?: string;
    isOemAuthorized?: boolean; oemProducts?: string;
    isBlacklisted?: boolean; blacklistReason?: string;
  };
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  // Blacklist toggle requires a reason when turning ON; turning off does not.
  if (body.isBlacklisted === true && !existing.isBlacklisted && !body.blacklistReason?.trim()) {
    return c.json({ error: 'blacklistReason is required when setting isBlacklisted to true' }, 400);
  }

  const update: Partial<typeof vendors.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.category !== undefined && VALID_CATEGORIES.includes(body.category)) update.category = body.category as typeof VALID_CATEGORIES[number];
  if (body.countryOfOrigin !== undefined) update.countryOfOrigin = body.countryOfOrigin;
  if (body.contactEmail !== undefined) update.contactEmail = body.contactEmail;
  if (body.contactPhone !== undefined) update.contactPhone = body.contactPhone;
  if (body.isOemAuthorized !== undefined) update.isOemAuthorized = body.isOemAuthorized;
  if (body.oemProducts !== undefined) update.oemProducts = body.oemProducts;

  const blacklistChanged = body.isBlacklisted !== undefined && body.isBlacklisted !== existing.isBlacklisted;
  if (body.isBlacklisted !== undefined) {
    update.isBlacklisted = body.isBlacklisted;
    update.blacklistReason = body.isBlacklisted ? (body.blacklistReason?.trim() ?? null) : null;
    update.blacklistedAt = body.isBlacklisted ? new Date() : null;
  }

  const [updated] = await db.update(vendors).set(update).where(eq(vendors.id, id)).returning();

  if (blacklistChanged) {
    await db.insert(auditLog).values({
      tenantId, actorId: userId, actorType: 'human',
      action: body.isBlacklisted ? 'vendor_blacklisted' : 'vendor_unblacklisted',
      resource: 'vendor', resourceId: id,
      metadata: { vendorName: updated.name, reason: update.blacklistReason ?? null },
      traceId: (c.get('traceId') as string | undefined) ?? '',
    });
  }

  return c.json(updated);
});
```

- [ ] **Step 2: Mount the route**

In `apps/api/src/app.ts`, add the import next to the other route imports (after the `tenderApprovalRoutes` import, around line 42):
```typescript
import { vendorsRoutes } from './routes/vendors';
```
And add the mount next to the other top-level resource mounts (after `api.route('/tender', tenderApprovalRoutes);` around line 222):
```typescript
api.route('/vendors', vendorsRoutes);
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/vendors.ts apps/api/src/app.ts
git commit -m "feat(vendor): vendor CRUD API routes"
```

---

## Task 4: Seed data

**Files:**
- Create: `apps/api/src/routes/vendorSeed.ts`
- Modify: `apps/api/src/routes/vendors.ts` (add an `ensureVendors` call at the top of the `GET /vendors` list handler, same idempotent-seed-on-first-access pattern as `ensureClauseLibrary` in `tenderAuthoring.ts`)

**Interfaces:**
- Consumes: `vendors` table.
- Produces: `SEED_VENDORS` array (12 entries), `ensureVendors(tenantId: string): Promise<void>` — called once from Task 3's list route.

- [ ] **Step 1: Write the seed data**

```typescript
// apps/api/src/routes/vendorSeed.ts
import { db, vendors } from '@serverless-saas/database';
import { eq } from 'drizzle-orm';

export const SEED_VENDORS = [
  { name: 'Bharat Steel & Engineering Works', category: 'cpsu' as const, countryOfOrigin: 'India', contactEmail: 'contracts@bharatsteel.example', isOemAuthorized: false },
  { name: 'Rajasthan Infra Development Corp', category: 'spsu' as const, countryOfOrigin: 'India', contactEmail: 'tenders@rajinfra.example', isOemAuthorized: false },
  { name: 'Nirman Micro Enterprises', category: 'mse' as const, countryOfOrigin: 'India', contactEmail: 'admin@nirmanmicro.example', isOemAuthorized: false },
  { name: 'Sahyog Self Help Producer Group', category: 'self_help_group' as const, countryOfOrigin: 'India', contactEmail: 'sahyog.shg@example.org', isOemAuthorized: false },
  { name: 'District Rural Development Agency', category: 'govt_body' as const, countryOfOrigin: 'India', contactEmail: 'drda.office@example.gov', isOemAuthorized: false },
  { name: 'Prakash Civil Contractors', category: 'civil_contractor' as const, countryOfOrigin: 'India', contactEmail: 'prakash.civil@example.com', isOemAuthorized: false },
  { name: 'Meridian Instrumentation Pvt Ltd', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'sales@meridianinst.example', isOemAuthorized: true, oemProducts: 'Flow meters, pressure transmitters (authorized OEM dealer)' },
  { name: 'Global Valve Systems India', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'info@globalvalve.example', isOemAuthorized: true, oemProducts: 'Industrial control valves, actuators' },
  { name: 'Suryoday MSE Fabricators', category: 'mse' as const, countryOfOrigin: 'India', contactEmail: 'suryoday.fab@example.com', isOemAuthorized: false },
  { name: 'Coastal Corrosion Solutions', category: 'civil_contractor' as const, countryOfOrigin: 'India', contactEmail: 'contact@coastalcorrosion.example', isOemAuthorized: false },
  { name: 'Vindhya Power Equipment Ltd', category: 'cpsu' as const, countryOfOrigin: 'India', contactEmail: 'tenders@vindhyapower.example', isOemAuthorized: false },
  {
    name: 'Ashoka General Suppliers', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'sales@ashokasuppliers.example',
    isOemAuthorized: false,
    isBlacklisted: true, blacklistReason: 'Debarred following CVC inquiry into bid-rigging on tender ref. GT-2024-0091 (illustrative demo record)',
  },
];

export async function ensureVendors(tenantId: string): Promise<void> {
  const [existing] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.tenantId, tenantId)).limit(1);
  if (existing) return;

  await db.insert(vendors).values(SEED_VENDORS.map(v => ({
    tenantId,
    name: v.name,
    category: v.category,
    countryOfOrigin: v.countryOfOrigin,
    contactEmail: v.contactEmail,
    isOemAuthorized: v.isOemAuthorized,
    oemProducts: 'oemProducts' in v ? v.oemProducts : null,
    isBlacklisted: 'isBlacklisted' in v ? v.isBlacklisted : false,
    blacklistReason: 'blacklistReason' in v ? v.blacklistReason : null,
    blacklistedAt: 'isBlacklisted' in v && v.isBlacklisted ? new Date() : null,
  })));
}
```

- [ ] **Step 2: Wire into the list route**

In `apps/api/src/routes/vendors.ts`, add the import at the top:
```typescript
import { ensureVendors } from './vendorSeed';
```
And add one line at the start of the `GET /` handler's body, right after `const tenantId = rc?.tenant?.id as string;`:
```typescript
  await ensureVendors(tenantId);
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/vendorSeed.ts apps/api/src/routes/vendors.ts
git commit -m "feat(vendor): seed 12 generic demo vendors, one blacklisted"
```

---

## Task 5: Bidder-vendor linking route — integration point 1

**Files:**
- Modify: `apps/api/src/routes/tender.ts` (add a new route near the existing bidder routes)

**Interfaces:**
- Consumes: `checkVendorBlacklist` (Task 2), `vendors` table, existing `bidders` table.
- Produces: `PATCH /tender/evaluations/:tenderId/bidders/:bidderId/vendor` — consumed by Task 8's web UI (linking a bidder to a vendor from the evaluation screen).

- [ ] **Step 1: Write the route**

Add this route to `apps/api/src/routes/tender.ts`, near the existing `DELETE /evaluations/:tenderId/bidders/:bidderId` route (same file already has bidder-scoped routes):

```typescript
// PATCH /tender/evaluations/:tenderId/bidders/:bidderId/vendor — link/unlink a vendor
tenderRoutes.patch('/evaluations/:tenderId/bidders/:bidderId/vendor', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const bidderId = c.req.param('bidderId');

  let body: { vendorId?: string | null };
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  const [bidder] = await db.select({ id: bidders.id }).from(bidders)
    .where(and(eq(bidders.id, bidderId), eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId)));
  if (!bidder) return c.json({ error: 'not found' }, 404);

  if (body.vendorId === null || body.vendorId === undefined) {
    await db.update(bidders).set({ vendorId: null }).where(eq(bidders.id, bidderId));
    return c.json({ ok: true, vendorId: null });
  }

  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, body.vendorId), eq(vendors.tenantId, tenantId)));
  if (!vendor) return c.json({ error: 'vendor not found' }, 404);

  const gate = checkVendorBlacklist({ isBlacklisted: vendor.isBlacklisted, blacklistReason: vendor.blacklistReason });
  if (gate.blocked) {
    return c.json({ error: `Cannot link a blacklisted vendor: ${gate.reason}` }, 422);
  }

  await db.update(bidders).set({ vendorId: vendor.id }).where(eq(bidders.id, bidderId));
  return c.json({ ok: true, vendorId: vendor.id });
});
```

Add the two new imports at the top of `apps/api/src/routes/tender.ts`:
```typescript
import { vendors } from '@serverless-saas/database';
import { checkVendorBlacklist } from './vendorBlacklist';
```
(`vendors` joins whatever existing `@serverless-saas/database` import line already exists in this file — add it to that line's destructured import list rather than a new import statement, e.g. `import { db, tenders, bidders, vendors, ... } from '@serverless-saas/database';`.)

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/tender.ts
git commit -m "feat(vendor): bidder-vendor linking route with blacklist gate"
```

---

## Task 6: Contract-formulation blacklist gate — integration point 2

**Files:**
- Create: `apps/relay/src/mastra/rules/vendorBlacklist.ts` (duplicate of Task 2's function — see Task 2's Interfaces note on why this is duplicated rather than shared across packages)
- Create: `apps/relay/src/mastra/rules/__tests__/vendorBlacklist.test.ts`
- Modify: `apps/relay/src/tender/tenderContract.ts` (add the gate check inside `generateContract`)

**Interfaces:**
- Consumes: `checkVendorBlacklist` (this task's own copy), `vendors` table, existing `bidders.vendorId` column (Task 1).
- Produces: `generateContract` now throws `Error('awarded bidder's vendor is blacklisted: ' + reason)` before generating a contract for a blacklisted vendor's bidder — consumed by whatever route calls `generateContract` (unchanged elsewhere; the error propagates the same way any other `generateContract` error already does).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/relay/src/mastra/rules/__tests__/vendorBlacklist.test.ts
import { describe, it, expect } from 'vitest';
import { checkVendorBlacklist } from '../vendorBlacklist.js';

describe('checkVendorBlacklist', () => {
  it('does not block when no vendor is linked', () => {
    expect(checkVendorBlacklist(null)).toEqual({ blocked: false, reason: null });
  });

  it('does not block a non-blacklisted vendor', () => {
    expect(checkVendorBlacklist({ isBlacklisted: false, blacklistReason: null })).toEqual({ blocked: false, reason: null });
  });

  it('blocks a blacklisted vendor and surfaces the reason', () => {
    expect(checkVendorBlacklist({ isBlacklisted: true, blacklistReason: 'Debarred' })).toEqual({ blocked: true, reason: 'Debarred' });
  });

  it('blocks a blacklisted vendor with a null reason using a default message', () => {
    expect(checkVendorBlacklist({ isBlacklisted: true, blacklistReason: null })).toEqual({ blocked: true, reason: 'Vendor is blacklisted' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/relay && npx vitest run src/mastra/rules/__tests__/vendorBlacklist.test.ts`
Expected: FAIL — `Cannot find module '../vendorBlacklist.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/relay/src/mastra/rules/vendorBlacklist.ts

export interface VendorBlacklistInput {
  isBlacklisted: boolean;
  blacklistReason: string | null;
}

export interface VendorBlacklistResult {
  blocked: boolean;
  reason: string | null;
}

export function checkVendorBlacklist(vendor: VendorBlacklistInput | null): VendorBlacklistResult {
  if (!vendor) return { blocked: false, reason: null };
  if (!vendor.isBlacklisted) return { blocked: false, reason: null };
  return { blocked: true, reason: vendor.blacklistReason ?? 'Vendor is blacklisted' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/relay && npx vitest run src/mastra/rules/__tests__/vendorBlacklist.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Wire the gate into `generateContract`**

In `apps/relay/src/tender/tenderContract.ts`, add the import at the top:
```typescript
import { checkVendorBlacklist } from '../mastra/rules/vendorBlacklist.js'
```
Change the `import { db, tenders, bidders, financialFindings, rfpSections, tenderContracts } from '@serverless-saas/database'` line to also import `vendors`:
```typescript
import { db, tenders, bidders, financialFindings, rfpSections, tenderContracts, vendors } from '@serverless-saas/database'
```

Then, immediately after the existing block that resolves `awardedBidder` (right after `const awardedBidder = awardedRow.bidder` and `const finding = awardedRow.finding`), insert:

```typescript
  if (awardedBidder.vendorId) {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, awardedBidder.vendorId))
    const gate = checkVendorBlacklist(vendor ? { isBlacklisted: vendor.isBlacklisted, blacklistReason: vendor.blacklistReason } : null)
    if (gate.blocked) {
      await writeTenderAuditLog({
        tenantId, actorId: 'system', action: 'contract_blocked_blacklisted_vendor', resource: 'tender', resourceId: tenderId,
        metadata: { bidderId: awardedBidder.id, vendorId: awardedBidder.vendorId, reason: gate.reason },
      })
      throw new Error(`Cannot generate contract — awarded bidder's linked vendor is blacklisted: ${gate.reason}`)
    }
  }
```

- [ ] **Step 6: Type-check**

Run: `cd apps/relay && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add apps/relay/src/mastra/rules/vendorBlacklist.ts apps/relay/src/mastra/rules/__tests__/vendorBlacklist.test.ts apps/relay/src/tender/tenderContract.ts
git commit -m "feat(vendor): block contract generation for blacklisted vendors, audited"
```

---

## Task 7: Participation history + rate-contract routes

**Files:**
- Modify: `apps/api/src/routes/vendors.ts` (add two new routes)

**Interfaces:**
- Consumes: `bidders`, `tenders`, `rateContracts` tables.
- Produces: `GET /vendors/:id/participation` (tender title, bidder status, date per tender the vendor's linked bidders appear in), `GET /vendors/:id/rate-contracts` (list) and `POST /vendors/:id/rate-contracts` (create) — consumed by Task 8's web UI detail view.

- [ ] **Step 1: Write the routes**

Add to `apps/api/src/routes/vendors.ts`. First, extend the `@serverless-saas/database` import at the top of the file to include `bidders`, `tenders`, `rateContracts`:
```typescript
import { db, vendors, bidders, tenders, rateContracts } from '@serverless-saas/database';
```

Then add these two route groups after the existing `PATCH /:id` route:

```typescript
// GET /vendors/:id/participation — derived from bidders.vendorId, joined to tenders
vendorsRoutes.get('/:id/participation', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  if (!vendor) return c.json({ error: 'not found' }, 404);

  const rows = await db.select({
    tenderId: tenders.id, rfpNumber: tenders.rfpNumber, tenderTitle: tenders.title,
    bidderStatus: bidders.status, submittedAt: bidders.createdAt,
  })
    .from(bidders)
    .innerJoin(tenders, eq(tenders.id, bidders.tenderId))
    .where(and(eq(bidders.vendorId, id), eq(bidders.tenantId, tenantId)))
    .orderBy(bidders.createdAt);

  return c.json({ participation: rows });
});

// GET /vendors/:id/rate-contracts
vendorsRoutes.get('/:id/rate-contracts', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  if (!vendor) return c.json({ error: 'not found' }, 404);

  const rows = await db.select().from(rateContracts)
    .where(and(eq(rateContracts.vendorId, id), eq(rateContracts.tenantId, tenantId)))
    .orderBy(rateContracts.createdAt);

  return c.json({ rateContracts: rows });
});

// POST /vendors/:id/rate-contracts — create
vendorsRoutes.post('/:id/rate-contracts', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  if (!vendor) return c.json({ error: 'not found' }, 404);

  let body: { contractType?: string; terms?: string; pricing?: object; validFrom?: string; validTo?: string };
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

  if (!body.contractType || !['limited', 'framework', 'rate'].includes(body.contractType)) {
    return c.json({ error: 'contractType must be one of: limited, framework, rate' }, 400);
  }

  const [row] = await db.insert(rateContracts).values({
    tenantId, vendorId: id,
    contractType: body.contractType as 'limited' | 'framework' | 'rate',
    terms: body.terms ?? null,
    pricing: body.pricing ?? {},
    validFrom: body.validFrom ? new Date(body.validFrom) : null,
    validTo: body.validTo ? new Date(body.validTo) : null,
  }).returning();

  return c.json(row, 201);
});
```

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/vendors.ts
git commit -m "feat(vendor): participation history + rate-contract routes"
```

---

## Task 8: Web dashboard page

**Files:**
- Create: `apps/web/app/[tenant]/dashboard/vendors/page.tsx`
- Create: `apps/web/app/[tenant]/dashboard/vendors/VendorList.tsx`
- Create: `apps/web/app/[tenant]/dashboard/vendors/VendorDetail.tsx`

**Interfaces:**
- Consumes: `GET /api/proxy/api/v1/vendors`, `GET /api/proxy/api/v1/vendors/:id`, `PATCH /api/proxy/api/v1/vendors/:id`, `GET /api/proxy/api/v1/vendors/:id/participation`, `GET /api/proxy/api/v1/vendors/:id/rate-contracts`, `POST /api/proxy/api/v1/vendors/:id/rate-contracts` (Tasks 3, 4, 7). Follows the same category-filter-chip pattern as `ClauseLibraryPanel.tsx` and the same fetch/mutation pattern as `AuthoringPanel.tsx` (`@tanstack/react-query`, `/api/proxy/api/v1/...` base path).

- [ ] **Step 1: Write the list component**

```tsx
// apps/web/app/[tenant]/dashboard/vendors/VendorList.tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

interface Vendor {
  id: string; name: string; category: string; countryOfOrigin: string | null;
  isBlacklisted: boolean; isOemAuthorized: boolean;
}

const CATEGORIES = ["cpsu", "spsu", "mse", "self_help_group", "govt_body", "civil_contractor", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  cpsu: "CPSU", spsu: "SPSU", mse: "MSE", self_help_group: "Self-Help Group",
  govt_body: "Govt Body", civil_contractor: "Civil Contractor", other: "Other",
};

async function fetchVendors(category: string): Promise<Vendor[]> {
  const qs = category ? `?category=${category}` : "";
  const res = await fetch(`/api/proxy/api/v1/vendors${qs}`);
  if (!res.ok) throw new Error("Failed to load vendors");
  const data = await res.json();
  return data.vendors ?? [];
}

export function VendorList({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const [filterCat, setFilterCat] = useState("");
  const { data: vendorList = [], isLoading } = useQuery({
    queryKey: ["vendors", filterCat],
    queryFn: () => fetchVendors(filterCat),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCat("")} className={`text-xs px-2 py-0.5 rounded-full border ${!filterCat ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>All</button>
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setFilterCat(f => f === cat ? "" : cat)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${filterCat === cat ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      <div className="space-y-1.5">
        {vendorList.map(v => (
          <div key={v.id} onClick={() => onSelect(v.id)}
            className={`p-2.5 rounded border cursor-pointer ${selectedId === v.id ? "border-primary bg-primary/5" : "border-border/50 hover:border-border bg-muted/10"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{v.name}</span>
              <div className="flex items-center gap-1.5">
                {v.isBlacklisted && <Badge className="text-xs border border-red-500/30 bg-red-500/10 text-red-400">Blacklisted</Badge>}
                {v.isOemAuthorized && <Badge className="text-xs border border-blue-500/30 bg-blue-500/10 text-blue-400">OEM</Badge>}
                <Badge className="text-xs border border-border/50 bg-muted/30 text-muted-foreground">{CATEGORY_LABELS[v.category] ?? v.category}</Badge>
              </div>
            </div>
            {v.countryOfOrigin && <p className="text-xs text-muted-foreground mt-0.5">{v.countryOfOrigin}</p>}
          </div>
        ))}
        {!isLoading && vendorList.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No vendors in this category.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the detail component**

```tsx
// apps/web/app/[tenant]/dashboard/vendors/VendorDetail.tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VendorFull {
  id: string; name: string; category: string; countryOfOrigin: string | null;
  contactEmail: string | null; contactPhone: string | null;
  isBlacklisted: boolean; blacklistReason: string | null;
  isOemAuthorized: boolean; oemProducts: string | null;
}
interface ParticipationRow { tenderId: string; rfpNumber: string; tenderTitle: string; bidderStatus: string; submittedAt: string }
interface RateContractRow { id: string; contractType: string; terms: string | null; validFrom: string | null; validTo: string | null }

async function fetchVendor(id: string): Promise<VendorFull> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}`);
  if (!res.ok) throw new Error("Failed to load vendor");
  return res.json();
}
async function fetchParticipation(id: string): Promise<ParticipationRow[]> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}/participation`);
  if (!res.ok) throw new Error("Failed to load participation");
  const data = await res.json();
  return data.participation ?? [];
}
async function fetchRateContracts(id: string): Promise<RateContractRow[]> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}/rate-contracts`);
  if (!res.ok) throw new Error("Failed to load rate contracts");
  const data = await res.json();
  return data.rateContracts ?? [];
}
async function toggleBlacklist(id: string, isBlacklisted: boolean, blacklistReason?: string) {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isBlacklisted, blacklistReason }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
}

export function VendorDetail({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  const [reasonInput, setReasonInput] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);

  const { data: vendor, isLoading } = useQuery({ queryKey: ["vendor", vendorId], queryFn: () => fetchVendor(vendorId) });
  const { data: participation = [] } = useQuery({ queryKey: ["vendor-participation", vendorId], queryFn: () => fetchParticipation(vendorId) });
  const { data: rateContractList = [] } = useQuery({ queryKey: ["vendor-rate-contracts", vendorId], queryFn: () => fetchRateContracts(vendorId) });

  const blacklistMutation = useMutation({
    mutationFn: ({ isBlacklisted, reason }: { isBlacklisted: boolean; reason?: string }) => toggleBlacklist(vendorId, isBlacklisted, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", vendorId] }); qc.invalidateQueries({ queryKey: ["vendors"] }); setShowReasonInput(false); setReasonInput(""); },
  });

  if (isLoading || !vendor) return <p className="text-xs text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{vendor.name}</h3>
        {vendor.isBlacklisted ? (
          <Button size="sm" variant="ghost" onClick={() => blacklistMutation.mutate({ isBlacklisted: false })} disabled={blacklistMutation.isPending} className="text-xs text-green-400">
            Remove from Blacklist
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setShowReasonInput(v => !v)} className="text-xs text-red-400">
            Blacklist Vendor
          </Button>
        )}
      </div>

      {vendor.isBlacklisted && (
        <div className="p-2.5 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-300">
          <b>Blacklisted:</b> {vendor.blacklistReason}
        </div>
      )}

      {showReasonInput && (
        <div className="space-y-2 p-2.5 rounded border border-border/50">
          <input value={reasonInput} onChange={e => setReasonInput(e.target.value)} placeholder="Reason for blacklisting (required)"
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground" />
          <Button size="sm" onClick={() => blacklistMutation.mutate({ isBlacklisted: true, reason: reasonInput })}
            disabled={!reasonInput.trim() || blacklistMutation.isPending} className="text-xs">
            {blacklistMutation.isPending ? "Saving…" : "Confirm Blacklist"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">Category:</span> {vendor.category}</div>
        <div><span className="text-muted-foreground">Country:</span> {vendor.countryOfOrigin ?? "—"}</div>
        <div><span className="text-muted-foreground">Email:</span> {vendor.contactEmail ?? "—"}</div>
        {vendor.isOemAuthorized && <div className="col-span-2"><Badge className="text-xs border border-blue-500/30 bg-blue-500/10 text-blue-400">OEM Authorized</Badge> {vendor.oemProducts}</div>}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Participation History</h4>
        {participation.length === 0 && <p className="text-xs text-muted-foreground">No tender participation linked yet.</p>}
        {participation.map(p => (
          <div key={p.tenderId} className="text-xs flex justify-between py-1 border-b border-border/20">
            <span>{p.rfpNumber} — {p.tenderTitle}</span>
            <span className="text-muted-foreground">{p.bidderStatus}</span>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Rate / Framework Contracts</h4>
        {rateContractList.length === 0 && <p className="text-xs text-muted-foreground">None on record.</p>}
        {rateContractList.map(rc => (
          <div key={rc.id} className="text-xs py-1 border-b border-border/20">
            <span className="font-medium">{rc.contractType}</span> — {rc.terms ?? "no terms recorded"}
            {rc.validFrom && rc.validTo && <span className="text-muted-foreground"> ({new Date(rc.validFrom).toLocaleDateString()} – {new Date(rc.validTo).toLocaleDateString()})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
// apps/web/app/[tenant]/dashboard/vendors/page.tsx
"use client";

import { useState } from "react";
import { VendorList } from "./VendorList";
import { VendorDetail } from "./VendorDetail";

export default function VendorsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Vendor Database</h1>
      <div className="flex gap-4">
        <div className="w-1/2">
          <VendorList onSelect={setSelectedId} selectedId={selectedId} />
        </div>
        <div className="w-1/2 rounded-lg border border-border bg-card p-4">
          {selectedId ? <VendorDetail vendorId={selectedId} /> : <p className="text-sm text-muted-foreground">Select a vendor to view details.</p>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Since this depends on a running dashboard + API (not unit-testable in isolation), verify once services are up (locally or on the VM per `TIER0-VERIFICATION-PLAN.md`):
1. Navigate to `/[tenant]/dashboard/vendors` — confirm the 12 seed vendors appear, filterable by category chip.
2. Select "Ashoka General Suppliers" — confirm it shows as blacklisted with the seeded reason.
3. Select a non-blacklisted vendor, click "Blacklist Vendor", try to confirm with an empty reason (button should stay disabled), then fill a reason and confirm — confirm the badge and reason appear, and `auditLog` gets a `vendor_blacklisted` row.
4. From an existing tender's bidder list, link a bidder to the blacklisted vendor via `PATCH /tender/evaluations/:tenderId/bidders/:bidderId/vendor` (no UI wiring for this in this pass — test via API call) — confirm 422.
5. Link a bidder to a non-blacklisted vendor, get that bidder awarded and L1 in an existing test tender, then attempt contract generation — confirm it proceeds normally when not blacklisted, and confirm (via a second test) that blacklisting the linked vendor after award and retrying contract generation returns the blocked error.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\[tenant\]/dashboard/vendors/
git commit -m "feat(vendor): dashboard page — list, detail, blacklist toggle"
```

---

## Self-Review

**Spec coverage:**
- Centralized vendor repository → Task 1 (`vendors` table) + Task 3 (CRUD).
- AVL/blacklist maintenance, "no tender/contract issued to a blacklisted vendor" → Task 2 (pure gate function), Task 5 (bidder-linking gate), Task 6 (contract-formulation gate, audited).
- Vendor participation history across tenders → Task 1 (`bidders.vendorId`) + Task 7 (`GET /vendors/:id/participation`).
- Category marking (CPSU/SPSU/MSE/Govt bodies/civil contractors/country of origin) → Task 1 (`vendorCategoryEnum` + `countryOfOrigin`).
- OEM/proprietary-vendor mapping → Task 1 (`isOemAuthorized`/`oemProducts` fields).
- Limited/framework/rate-contract vendor data → Task 1 (`rateContracts` table) + Task 7 (routes).
- New dashboard page → Task 8.
- Seed data → Task 4.

**Placeholder scan:** none — every step has complete code. Task 2's Interfaces note about cross-package imports is an explicit, bounded decision point (confirm-then-default), not an open placeholder — it names its own fallback if the confirming check comes back differently.

**Type consistency:**
- `checkVendorBlacklist(vendor: {isBlacklisted, blacklistReason} | null): {blocked, reason}` is identical across Task 2's `apps/api` copy and Task 6's `apps/relay` copy (same signature, same body, deliberately duplicated per Task 2's interfaces note).
- `vendors` table field names (`isBlacklisted`, `blacklistReason`, `blacklistedAt`, `isOemAuthorized`, `oemProducts`, `countryOfOrigin`) are used identically across Task 1's schema, Task 3's CRUD route, Task 4's seed data, Task 6's gate call site, and Task 8's UI components.
- `bidders.vendorId` (Task 1) is read/written identically in Task 5 (linking route), Task 6 (contract gate), and Task 7 (participation query).
- `rateContracts` fields (`contractType`, `terms`, `pricing`, `validFrom`, `validTo`) match between Task 1's schema and Task 7's route + Task 8's UI rendering.

No gaps found between the spec and the task list.
