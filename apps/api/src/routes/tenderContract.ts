// apps/api/src/routes/tenderContract.ts
import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { tenders } from '@serverless-saas/database/schema/tender';
import { tenderContracts } from '@serverless-saas/database/schema/tender-contract';
import { eq, and, desc } from 'drizzle-orm';
import { buildContractWordDoc } from './tenderContractExport';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderContractRoutes = new Hono<AppEnv>();

// POST /tender/:tenderId/contract/generate — trigger a new contract version
tenderContractRoutes.post('/:tenderId/contract/generate', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/contract/generate`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId, tenantId }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok) return c.json(data, res.status as 404 | 409 | 500 | 502);
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET /tender/:tenderId/contract — list all versions, newest first
tenderContractRoutes.get('/:tenderId/contract', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const contracts = await db.select().from(tenderContracts)
    .where(and(eq(tenderContracts.tenderId, tenderId), eq(tenderContracts.tenantId, tenantId)))
    .orderBy(desc(tenderContracts.version));

  return c.json({ contracts });
});

// GET /tender/:tenderId/contract/:contractId/export — download as Word-compatible .doc
tenderContractRoutes.get('/:tenderId/contract/:contractId/export', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const contractId = c.req.param('contractId');

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const [contract] = await db.select().from(tenderContracts)
    .where(and(eq(tenderContracts.id, contractId), eq(tenderContracts.tenderId, tenderId), eq(tenderContracts.tenantId, tenantId)));
  if (!contract) return c.json({ error: 'contract not found' }, 404);

  const doc = buildContractWordDoc(
    { rfpNumber: tender.rfpNumber, title: tender.title, department: tender.department },
    {
      contractorName: contract.contractorName,
      contractorDisplayLabel: contract.contractorDisplayLabel,
      contractorContactEmail: contract.contractorContactEmail,
      contractValue: contract.contractValue,
      sections: contract.sections as any,
      version: contract.version,
    }
  );

  return new Response(doc, {
    headers: {
      'Content-Type': 'application/msword',
      'Content-Disposition': `attachment; filename="${tender.rfpNumber.replace(/[^a-zA-Z0-9-]/g, '_')}-contract-v${contract.version}.doc"`,
    },
  });
});
