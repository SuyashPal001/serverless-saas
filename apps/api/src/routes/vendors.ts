import { Hono } from 'hono';
import { db, vendors, bidders, tenders, rateContracts } from '@serverless-saas/database';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';
import { ensureVendors } from './vendorSeed';

export const vendorsRoutes = new Hono<AppEnv>();

const VALID_CATEGORIES = ['cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other'] as const;
const isValidCategory = (value: string): value is typeof VALID_CATEGORIES[number] =>
  (VALID_CATEGORIES as readonly string[]).includes(value);

// GET /vendors — list, optionally filtered by category and/or blacklist status
vendorsRoutes.get('/', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  await ensureVendors(tenantId);
  const category = c.req.query('category');
  const blacklisted = c.req.query('blacklisted');

  const conditions = [eq(vendors.tenantId, tenantId)];
  if (category && isValidCategory(category)) {
    conditions.push(eq(vendors.category, category));
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
  const category = body.category && isValidCategory(body.category) ? body.category : 'other';

  const [vendor] = await db.insert(vendors).values({
    tenantId,
    name: body.name.trim(),
    category,
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
  if (body.category !== undefined && isValidCategory(body.category)) update.category = body.category;
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

  const [updated] = await db.update(vendors).set(update).where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId))).returning();

  if (blacklistChanged) {
    db.insert(auditLog).values({
      tenantId, actorId: userId ?? 'system', actorType: 'human',
      action: body.isBlacklisted ? 'vendor_blacklisted' : 'vendor_unblacklisted',
      resource: 'vendor', resourceId: id,
      metadata: { vendorName: updated.name, reason: update.blacklistReason ?? null },
      traceId: (c.get('traceId') as string | undefined) ?? '',
    }).catch((err: unknown) => console.error('Audit log write failed:', err));
  }

  return c.json(updated);
});

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
