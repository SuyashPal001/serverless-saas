import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { prebidQueries, corrigenda, tenders } from '@serverless-saas/database/schema/tender';
import { rfpSections, rfpSectionVersions } from '@serverless-saas/database/schema/tender-authoring';
import { eq, and, asc, count } from 'drizzle-orm';
import type { AppEnv } from '../types';

const RELAY_URL = (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const INTERNAL_KEY = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  return { 'Content-Type': 'application/json', ...(INTERNAL_KEY ? { 'x-internal-service-key': INTERNAL_KEY } : {}) };
}

export const tenderPrebidRoutes = new Hono<AppEnv>();

// GET /tender/prebid/:tenderId — list queries + corrigenda
tenderPrebidRoutes.get('/prebid/:tenderId', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');

  const [queries, corrigendaRows] = await Promise.all([
    db.select().from(prebidQueries)
      .where(and(eq(prebidQueries.tenderId, tenderId), eq(prebidQueries.tenantId, tenantId)))
      .orderBy(asc(prebidQueries.createdAt)),
    db.select().from(corrigenda)
      .where(and(eq(corrigenda.tenderId, tenderId), eq(corrigenda.tenantId, tenantId)))
      .orderBy(asc(corrigenda.issuedAt)),
  ]);

  return c.json({ queries, corrigenda: corrigendaRows });
});

// POST /tender/prebid/:tenderId/queries — capture a new pre-bid query
tenderPrebidRoutes.post('/prebid/:tenderId/queries', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const body = await c.req.json<{ queryText: string; raisedBy?: string }>();
  if (!body.queryText?.trim()) return c.json({ error: 'queryText required' }, 400);

  const [existing] = await db.select({ n: count() }).from(prebidQueries)
    .where(and(eq(prebidQueries.tenderId, tenderId), eq(prebidQueries.tenantId, tenantId)));
  const queryNo = `Q-${String((existing?.n ?? 0) + 1).padStart(3, '0')}`;

  const [row] = await db.insert(prebidQueries).values({
    tenderId, tenantId, queryNo,
    raisedBy: body.raisedBy ?? null,
    queryText: body.queryText.trim(),
    status: 'received',
  }).returning();

  return c.json(row, 201);
});

// POST /tender/prebid/:tenderId/queries/:queryId/draft — AI-draft a response
tenderPrebidRoutes.post('/prebid/:tenderId/queries/:queryId/draft', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const { tenderId, queryId } = c.req.param();

  const [query] = await db.select().from(prebidQueries)
    .where(and(eq(prebidQueries.id, queryId), eq(prebidQueries.tenderId, tenderId)));
  if (!query) return c.json({ error: 'query not found' }, 404);

  try {
    const res = await fetch(`${RELAY_URL}/internal/tender/prebid/draft`, {
      method: 'POST', headers: relayHeaders(),
      body: JSON.stringify({ tenderId, tenantId, queryText: query.queryText, queryNo: query.queryNo }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    const { draftedText } = await res.json() as { draftedText: string };

    const [updated] = await db.update(prebidQueries)
      .set({ draftedResponse: draftedText, status: 'draft_ready' })
      .where(eq(prebidQueries.id, queryId))
      .returning();

    return c.json(updated);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /tender/prebid/:tenderId/queries/:queryId/accept — officer accepts response
tenderPrebidRoutes.post('/prebid/:tenderId/queries/:queryId/accept', async (c) => {
  const { tenderId, queryId } = c.req.param();
  const body = await c.req.json<{ finalResponse?: string }>().catch(() => ({ finalResponse: undefined }));

  const [query] = await db.select().from(prebidQueries)
    .where(and(eq(prebidQueries.id, queryId), eq(prebidQueries.tenderId, tenderId)));
  if (!query) return c.json({ error: 'query not found' }, 404);

  const finalResponse = body.finalResponse?.trim() || query.draftedResponse || '';
  if (!finalResponse) return c.json({ error: 'no response text to accept' }, 400);

  const [updated] = await db.update(prebidQueries)
    .set({ finalResponse, status: 'responded' })
    .where(eq(prebidQueries.id, queryId))
    .returning();

  return c.json(updated);
});

// POST /tender/prebid/:tenderId/corrigendum — issue a corrigendum, bump RFP version
tenderPrebidRoutes.post('/prebid/:tenderId/corrigendum', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = rc?.userId as string | undefined;
  const tenderId = c.req.param('tenderId');
  const body = await c.req.json<{
    queryId?: string;
    changesSummary: string;
    changedClauses: Array<{ sectionNo: string; clauseNo?: string; from: string; to: string }>;
  }>();
  if (!body.changesSummary || !body.changedClauses?.length) {
    return c.json({ error: 'changesSummary and changedClauses required' }, 400);
  }

  const [tender] = await db.select().from(tenders).where(eq(tenders.id, tenderId));
  if (!tender) return c.json({ error: 'tender not found' }, 404);

  const versionBefore = tender.version;
  const versionAfter = versionBefore + 1;

  const [existing] = await db.select({ n: count() }).from(corrigenda)
    .where(and(eq(corrigenda.tenderId, tenderId), eq(corrigenda.tenantId, tenantId)));
  const corrigendumNo = `Corrigendum No. ${(existing?.n ?? 0) + 1}`;

  // Version-snapshot each affected section before the change
  for (const change of body.changedClauses) {
    const [section] = await db.select().from(rfpSections)
      .where(and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId), eq(rfpSections.sectionNo, change.sectionNo)));
    if (section) {
      await db.insert(rfpSectionVersions).values({
        sectionId: section.id, tenderId, tenantId,
        version: section.version,
        content: section.content as object,
        changeNote: `${corrigendumNo}: ${change.clauseNo ?? change.sectionNo} amended`,
        editedBy: userId ?? null,
      });
      await db.update(rfpSections)
        .set({ version: section.version + 1, updatedAt: new Date() })
        .where(eq(rfpSections.id, section.id));
    }
  }

  await db.update(tenders).set({ version: versionAfter }).where(eq(tenders.id, tenderId));

  const [corr] = await db.insert(corrigenda).values({
    tenderId, tenantId,
    corrigendumNo, changesSummary: body.changesSummary,
    changedClauses: body.changedClauses,
    rfpVersionBefore: versionBefore,
    rfpVersionAfter: versionAfter,
    queryId: body.queryId ?? null,
    issuedAt: new Date(),
  }).returning();

  return c.json({ corrigendum: corr, rfpVersionBefore: versionBefore, rfpVersionAfter: versionAfter }, 201);
});
