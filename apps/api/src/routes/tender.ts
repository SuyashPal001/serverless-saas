import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import {
  tenders, bidders, pqFindings, technicalFindings,
  shortfalls, clarificationRequests, financialFindings,
  evaluationReports, tenderOfficerActions,
} from '@serverless-saas/database/schema/tender';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  console.log(`[tender] keyPresent: ${key.length > 0}`);
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderRoutes = new Hono<AppEnv>();

// DELETE /tender/evaluations/:id — delete tender + all cascaded child rows
tenderRoutes.delete('/evaluations/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const id = c.req.param('id');

  const [deleted] = await db.delete(tenders)
    .where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)))
    .returning({ id: tenders.id });

  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// GET /tender/evaluations — list tenders for tenant
tenderRoutes.get('/evaluations', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const rows = await db.select().from(tenders).where(eq(tenders.tenantId, tenantId));
  return c.json(rows);
});

// GET /tender/evaluations/:id — single tender with all evaluation data
tenderRoutes.get('/evaluations/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const id = c.req.param('id');

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const [bidderRows, pqRows, techRows, sfRows, crRows, finRows, reportRows] = await Promise.all([
    db.select().from(bidders).where(eq(bidders.tenderId, id)),
    db.select().from(pqFindings).where(eq(pqFindings.tenderId, id)),
    db.select().from(technicalFindings).where(eq(technicalFindings.tenderId, id)),
    db.select().from(shortfalls).where(eq(shortfalls.tenderId, id)),
    db.select().from(clarificationRequests).where(eq(clarificationRequests.tenderId, id)),
    db.select().from(financialFindings).where(eq(financialFindings.tenderId, id)),
    db.select().from(evaluationReports).where(eq(evaluationReports.tenderId, id)),
  ]);

  return c.json({
    ...tender,
    bidders: bidderRows,
    pqFindings: pqRows,
    technicalFindings: techRows,
    shortfalls: sfRows,
    clarificationRequests: crRows,
    financialFindings: finRows,
    report: reportRows[0] ?? null,
  });
});

// POST /tender/evaluations/:id/run — trigger full workflow via relay
tenderRoutes.post('/evaluations/:id/run', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const id = c.req.param('id');

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/run`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId: id, tenantId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    const data = await res.json();
    return c.json(data, 202);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /tender/evaluations/:id/technical/run — live technical evaluation only
tenderRoutes.post('/evaluations/:id/technical/run', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const id = c.req.param('id');
  const body = await c.req.json<{ bidderId?: string }>().catch(() => ({ bidderId: undefined }));

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/technical/run`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId: id, tenantId, bidderId: body.bidderId }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /tender/findings/action — officer Accept/Override/Escalate on any finding
tenderRoutes.post('/findings/action', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const userId = c.get('userId') as string;

  const body = await c.req.json<{
    tenderId: string; findingType: 'pq' | 'technical' | 'financial';
    findingId?: string; action: 'accept' | 'override' | 'escalate';
    rationale?: string; actorRole: string;
  }>();

  if ((body.action === 'override' || body.action === 'escalate') && !body.rationale?.trim()) {
    return c.json({ error: 'rationale required for override/escalate' }, 400);
  }

  await db.insert(tenderOfficerActions).values({
    tenantId, tenderId: body.tenderId,
    findingType: body.findingType,
    findingId: body.findingId ?? null,
    action: body.action,
    rationale: body.rationale ?? null,
    actorId: userId ?? null,
    actorRole: body.actorRole,
  });

  // Tamper-evident audit log
  db.insert(auditLog).values({
    tenantId, actorId: userId ?? 'system', actorType: 'human',
    action: `tender_${body.action}`,
    resource: `tender_${body.findingType}_finding`,
    resourceId: body.findingId ?? body.tenderId,
    metadata: { findingType: body.findingType, rationale: body.rationale, actorRole: body.actorRole },
    traceId: (c.get('traceId') as string | undefined) ?? '',
  }).catch((err: unknown) => console.error('Audit log write failed:', err));

  return c.json({ ok: true });
});
