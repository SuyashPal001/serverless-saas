import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { db } from '@serverless-saas/database';
import {
  tenders, bidders, pqFindings, technicalFindings,
  shortfalls, clarificationRequests, financialFindings,
  evaluationReports, tenderOfficerActions, bidderTechnicalScores,
} from '@serverless-saas/database/schema/tender';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and, count, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

function bidderFolderId(tenantId: string, tenderId: string, displayLabel: string): string {
  const stem = displayLabel.toLowerCase().replace(/\s+/g, '-');
  const h = createHash('sha256').update(`${tenantId}:bidder:${tenderId}:${stem}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function deriveEvalProgress(pqCount: number, techCount: number, finCount: number, reportExists: boolean) {
  const pq = pqCount > 0 ? 'done' : 'pending';
  const technical = techCount > 0 ? 'done' : 'pending';
  // shortfall step runs between technical and financial — done if financial has landed
  const shortfall = finCount > 0 ? 'done' : 'pending';
  const financial = finCount > 0 ? 'done' : 'pending';
  const report = reportExists ? 'done' : 'pending';
  const status = reportExists ? 'completed' : pqCount > 0 ? 'running' : 'pending';
  return { status, stages: { pq, technical, shortfall, financial, report } };
}

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

  const [bidderRows, pqRows, techRows, sfRows, crRows, finRows, reportRows, btsRows] = await Promise.all([
    db.select().from(bidders).where(eq(bidders.tenderId, id)),
    db.select().from(pqFindings).where(eq(pqFindings.tenderId, id)),
    db.select().from(technicalFindings).where(eq(technicalFindings.tenderId, id)),
    db.select().from(shortfalls).where(eq(shortfalls.tenderId, id)),
    db.select().from(clarificationRequests).where(eq(clarificationRequests.tenderId, id)),
    db.select().from(financialFindings).where(eq(financialFindings.tenderId, id)),
    db.select().from(evaluationReports).where(eq(evaluationReports.tenderId, id)),
    db.select().from(bidderTechnicalScores).where(eq(bidderTechnicalScores.tenderId, id)),
  ]);

  // Derive per-bidder embedding readiness from document_chunks (person_folder_id column is raw SQL only)
  let embeddedFolderIds = new Set<string>();
  if (bidderRows.length > 0) {
    const result = await db.execute(sql`
      SELECT DISTINCT person_folder_id::text AS fid
      FROM document_chunks
      WHERE tenant_id = ${tenantId}::uuid AND person_folder_id IS NOT NULL
    `);
    // db.execute() returns rows directly (array) with postgres-js, or { rows } with node-postgres
    const chunkRows: Array<{ fid: string }> = (Array.isArray(result) ? result : (result.rows ?? [])) as Array<{ fid: string }>;
    embeddedFolderIds = new Set(chunkRows.map(r => r.fid));
  }

  const biddersWithStatus = bidderRows.map(b => ({
    ...b,
    embeddingReady: embeddedFolderIds.has(bidderFolderId(tenantId, id, b.displayLabel)),
  }));

  const evalProgress = deriveEvalProgress(pqRows.length, techRows.length, finRows.length, !!reportRows[0]);
  return c.json({
    ...tender,
    scoringConfig: tender.scoringConfig,
    bidders: biddersWithStatus,
    pqFindings: pqRows,
    technicalFindings: techRows,
    shortfalls: sfRows,
    clarificationRequests: crRows,
    financialFindings: finRows,
    report: reportRows[0] ?? null,
    bidderTechnicalScores: btsRows,
    evalProgress,
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

// POST /tender/evaluations/:id/bidders — upload bid docs for a new bidder (base64 JSON)
tenderRoutes.post('/evaluations/:id/bidders', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const id = c.req.param('id');

  const body = await c.req.json<{
    name: string;
    files: Array<{ name: string; mimeType: string; dataBase64: string }>;
  }>().catch(() => null);
  if (!body?.name?.trim() || !body.files?.length) {
    return c.json({ error: 'name and files required' }, 400);
  }

  const [tender] = await db.select({ id: tenders.id }).from(tenders)
    .where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const LABELS = 'ABCDEFGHIJKLMNOP';
  const [{ n }] = await db.select({ n: count() }).from(bidders)
    .where(and(eq(bidders.tenderId, id), eq(bidders.tenantId, tenantId)));
  const displayLabel = `Bidder ${LABELS[Number(n)] ?? String(Number(n) + 1)}`;

  const [bidder] = await db.insert(bidders).values({
    tenderId: id, tenantId, name: body.name.trim(), displayLabel, status: 'submitted',
  }).returning();

  // Fire-and-forget to relay — ingest runs in background PM2 process
  fetch(`${relayUrl()}/internal/tender/bid-ingest`, {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify({ tenderId: id, tenantId, displayLabel, files: body.files }),
    signal: AbortSignal.timeout(10_000),
  }).catch(err => console.error(`[bid-upload] relay: ${(err as Error).message}`));

  return c.json({ bidderId: bidder.id, displayLabel, status: 'received' }, 202);
});

// DELETE /tender/evaluations/:tenderId/bidders/:bidderId — remove bidder + docs + findings
tenderRoutes.delete('/evaluations/:tenderId/bidders/:bidderId', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const tenderId = c.req.param('tenderId');
  const bidderId = c.req.param('bidderId');

  const [bidder] = await db.select({ id: bidders.id, displayLabel: bidders.displayLabel })
    .from(bidders)
    .where(and(eq(bidders.id, bidderId), eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId)));
  if (!bidder) return c.json({ error: 'not found' }, 404);

  const folderId = bidderFolderId(tenantId, tenderId, bidder.displayLabel);

  // Delete documents whose chunks live in this bidder's folder; chunks cascade automatically
  await db.execute(sql`
    DELETE FROM documents WHERE id IN (
      SELECT DISTINCT document_id FROM document_chunks
      WHERE person_folder_id = ${folderId}::uuid AND tenant_id = ${tenantId}::uuid
    )
  `);
  await db.execute(sql`
    DELETE FROM person_folders WHERE id = ${folderId}::uuid AND tenant_id = ${tenantId}::uuid
  `);

  // Deleting the bidder cascades to pq_findings, technical_findings, shortfalls,
  // clarification_requests, financial_findings, bids
  await db.delete(bidders)
    .where(and(eq(bidders.id, bidderId), eq(bidders.tenderId, tenderId), eq(bidders.tenantId, tenantId)));

  return c.json({ ok: true });
});
