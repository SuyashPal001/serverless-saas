// apps/api/src/routes/tenderApproval.ts
import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { tenders } from '@serverless-saas/database/schema/tender';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderApprovalRoutes = new Hono<AppEnv>();

tenderApprovalRoutes.post('/:tenderId/approval/submit', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const tenderId = c.req.param('tenderId');
  const body = await c.req.json<{ resourceType?: 'contract'; resourceId?: string }>();
  if (!body.resourceType || !body.resourceId) return c.json({ error: 'resourceType and resourceId required' }, 400);

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/approval/submit`, {
      method: 'POST', headers: relayHeaders(),
      body: JSON.stringify({ tenderId, tenantId, resourceType: body.resourceType, resourceId: body.resourceId, actorId: userId }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    if (!res.ok) return c.json(data, res.status as 400 | 404 | 409 | 500);
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

tenderApprovalRoutes.post('/:tenderId/approval/act', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const tenderId = c.req.param('tenderId');
  const body = await c.req.json<{ stepId?: string; action?: 'approve' | 'reject'; approverRole?: string; comment?: string; signatureRef?: string }>();
  if (!body.stepId || !body.action || !body.approverRole) return c.json({ error: 'stepId, action, approverRole required' }, 400);

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/approval/act`, {
      method: 'POST', headers: relayHeaders(),
      body: JSON.stringify({
        tenderId, tenantId, stepId: body.stepId, action: body.action,
        actorId: userId, approverRole: body.approverRole, comment: body.comment, signatureRef: body.signatureRef,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    if (!res.ok) return c.json(data, res.status as 400 | 403 | 404 | 409 | 500);
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

tenderApprovalRoutes.get('/:tenderId/approval/chain/:resourceType/:resourceId', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const resourceType = c.req.param('resourceType');
  const resourceId = c.req.param('resourceId');

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(
      `${relayUrl()}/internal/tender/approval/chain/${tenderId}/${resourceType}/${resourceId}?tenantId=${tenantId}`,
      { headers: relayHeaders(), signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json();
    if (!res.ok) return c.json(data, res.status as 400 | 404 | 500);
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

tenderApprovalRoutes.get('/approval/inbox', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const approverRole = c.req.query('approverRole');
  if (!approverRole) return c.json({ error: 'approverRole query param required' }, 400);

  try {
    const res = await fetch(
      `${relayUrl()}/internal/tender/approval/inbox/${encodeURIComponent(approverRole)}?tenantId=${tenantId}`,
      { headers: relayHeaders(), signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json();
    if (!res.ok) return c.json(data, res.status as 400 | 500);
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});
