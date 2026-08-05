// apps/api/src/routes/tenderProposal.ts
import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { tenders } from '@serverless-saas/database/schema/tender';
import { tenderProposals } from '@serverless-saas/database/schema/tender-proposal';
import { eq, and, desc } from 'drizzle-orm';
import { buildProposalWordDoc } from './tenderProposalExport';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderProposalRoutes = new Hono<AppEnv>();

// POST /tender/:tenderId/proposal/generate — trigger a new proposal version
tenderProposalRoutes.post('/:tenderId/proposal/generate', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/proposal/generate`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId, tenantId }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    const data = await res.json();
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET /tender/:tenderId/proposal — list all versions, newest first
tenderProposalRoutes.get('/:tenderId/proposal', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const proposals = await db.select().from(tenderProposals)
    .where(and(eq(tenderProposals.tenderId, tenderId), eq(tenderProposals.tenantId, tenantId)))
    .orderBy(desc(tenderProposals.version));

  return c.json({ proposals });
});

// GET /tender/:tenderId/proposal/:proposalId/export — download as Word-compatible .doc
tenderProposalRoutes.get('/:tenderId/proposal/:proposalId/export', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const proposalId = c.req.param('proposalId');

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const [proposal] = await db.select().from(tenderProposals)
    .where(and(eq(tenderProposals.id, proposalId), eq(tenderProposals.tenderId, tenderId), eq(tenderProposals.tenantId, tenantId)));
  if (!proposal) return c.json({ error: 'proposal not found' }, 404);

  const doc = buildProposalWordDoc(
    { rfpNumber: tender.rfpNumber, title: tender.title, department: tender.department },
    {
      execSummary: proposal.execSummary,
      complianceMatrix: proposal.complianceMatrix as any,
      priceComparison: proposal.priceComparison as any,
      rejectionGrounds: proposal.rejectionGrounds as any,
      recommendation: proposal.recommendation,
      version: proposal.version,
    }
  );

  return new Response(doc, {
    headers: {
      'Content-Type': 'application/msword',
      'Content-Disposition': `attachment; filename="${tender.rfpNumber.replace(/[^a-zA-Z0-9-]/g, '_')}-proposal-v${proposal.version}.doc"`,
    },
  });
});
