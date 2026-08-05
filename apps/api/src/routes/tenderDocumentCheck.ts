import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { documentChecks } from '@serverless-saas/database/schema/tender-document-check';
import { tenders } from '@serverless-saas/database/schema/tender';
import { eq, and, asc } from 'drizzle-orm';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderDocumentCheckRoutes = new Hono<AppEnv>();

// GET /tender/:tenderId/document-check — list current results
tenderDocumentCheckRoutes.get('/:tenderId/document-check', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const results = await db.select().from(documentChecks)
    .where(and(eq(documentChecks.tenderId, tenderId), eq(documentChecks.tenantId, tenantId)))
    .orderBy(asc(documentChecks.sectionNo), asc(documentChecks.ruleId));

  return c.json({ results });
});

// POST /tender/:tenderId/document-check/run — trigger a check run
tenderDocumentCheckRoutes.post('/:tenderId/document-check/run', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/document-check`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId, tenantId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    const data = await res.json();
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});
