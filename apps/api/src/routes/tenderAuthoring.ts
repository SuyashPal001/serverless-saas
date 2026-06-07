import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { tenders } from '@serverless-saas/database/schema/tender';
import { clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database/schema/tender-authoring';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and, asc } from 'drizzle-orm';
import type { AppEnv } from '../types';
import { buildWordDoc } from './tenderExport';
import { SEED_CLAUSES } from './tenderClauseSeed';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  const key = internalKey();
  console.log(`[tender-authoring] keyPresent: ${key.length > 0}`);
  return { 'Content-Type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) };
}

export const tenderAuthoringRoutes = new Hono<AppEnv>();

// ── Tender List ───────────────────────────────────────────────────────────────

tenderAuthoringRoutes.get('/list', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const rows = await db.select().from(tenders).where(eq(tenders.tenantId, tenantId)).orderBy(asc(tenders.createdAt));
  return c.json(rows);
});

// ── Authoring create + generate ───────────────────────────────────────────────

tenderAuthoringRoutes.post('/authoring', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;

  const body = await c.req.json<{
    title: string; department: string; budget?: number; category?: string;
    procurementMode?: string; contractDuration?: string; keyDates?: Record<string, string>;
    requirementText?: string;
  }>();

  if (!body.title || !body.department) return c.json({ error: 'title and department required' }, 400);

  await ensureClauseLibrary(tenantId);

  const rfpNumber = `RFP/${body.department.slice(0, 6).toUpperCase()}/${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}/${String(Math.floor(Math.random() * 900) + 100)}`;

  const [tender] = await db.insert(tenders).values({
    tenantId, rfpNumber,
    title: body.title,
    department: body.department,
    budget: body.budget ? String(body.budget) : null,
    evalMethod: body.procurementMode?.includes('QCBS') ? 'QCBS' : 'L1',
    status: 'authoring',
    authoringStatus: 'generating',
    templateFields: {
      category: body.category ?? 'IT/Software',
      procurementMode: body.procurementMode ?? 'Two-Bid (Technical + Financial)',
      contractDuration: body.contractDuration ?? '36 months',
      keyDates: body.keyDates ?? {},
    },
    requirementText: body.requirementText ?? null,
  }).returning();

  // Relay returns 202 immediately; generation runs in background PM2 process
  try {
    const res = await fetch(`${relayUrl()}/internal/tender/author`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId: tender.id, tenantId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tender.id));
      return c.json({ error: `Relay error ${res.status}` }, 502);
    }
  } catch (err) {
    await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, tender.id));
    return c.json({ error: (err as Error).message }, 500);
  }

  return c.json({ tenderId: tender.id, rfpNumber: tender.rfpNumber });
});

// ── Get authored RFP ──────────────────────────────────────────────────────────

tenderAuthoringRoutes.get('/authoring/:id', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [tender] = await db.select().from(tenders).where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const sections = await db.select().from(rfpSections)
    .where(and(eq(rfpSections.tenderId, id), eq(rfpSections.tenantId, tenantId)))
    .orderBy(asc(rfpSections.sectionNo));

  return c.json({ tender, sections });
});

// ── Retry generation ──────────────────────────────────────────────────────────

tenderAuthoringRoutes.post('/authoring/:id/retry', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');

  const [tender] = await db.select().from(tenders).where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  await db.update(tenders).set({ authoringStatus: 'generating' }).where(eq(tenders.id, id));

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/author`, {
      method: 'POST', headers: relayHeaders(),
      body: JSON.stringify({ tenderId: id, tenantId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, id));
      return c.json({ error: `Relay error ${res.status}` }, 502);
    }
  } catch (err) {
    await db.update(tenders).set({ authoringStatus: 'failed' }).where(eq(tenders.id, id));
    return c.json({ error: (err as Error).message }, 500);
  }

  return c.json({ ok: true });
});

// ── Section accept ────────────────────────────────────────────────────────────

tenderAuthoringRoutes.post('/authoring/:id/sections/:sectionId/accept', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const { id, sectionId } = c.req.param();

  const [section] = await db.select().from(rfpSections).where(and(eq(rfpSections.id, sectionId), eq(rfpSections.tenderId, id)));
  if (!section) return c.json({ error: 'section not found' }, 404);

  await db.insert(rfpSectionVersions).values({
    sectionId, tenderId: id, tenantId, version: section.version,
    content: section.content as object, changeNote: 'accept', editedBy: userId,
  });
  const newVersion = section.version + 1;
  await db.update(rfpSections).set({ version: newVersion, acceptedAt: new Date(), updatedAt: new Date() }).where(eq(rfpSections.id, sectionId));

  return c.json({ ok: true, version: newVersion });
});

// ── Section edit ──────────────────────────────────────────────────────────────

tenderAuthoringRoutes.patch('/authoring/:id/sections/:sectionId', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const { id, sectionId } = c.req.param();
  const body = await c.req.json<{ content: object; changeNote?: string }>();

  const [section] = await db.select().from(rfpSections).where(and(eq(rfpSections.id, sectionId), eq(rfpSections.tenderId, id)));
  if (!section) return c.json({ error: 'section not found' }, 404);

  await db.insert(rfpSectionVersions).values({
    sectionId, tenderId: id, tenantId, version: section.version,
    content: section.content as object, changeNote: body.changeNote ?? 'edit', editedBy: userId,
  });
  const newVersion = section.version + 1;
  await db.update(rfpSections).set({ content: body.content, version: newVersion, acceptedAt: null, updatedAt: new Date() }).where(eq(rfpSections.id, sectionId));

  return c.json({ ok: true, version: newVersion });
});

// ── Section regenerate ────────────────────────────────────────────────────────

tenderAuthoringRoutes.post('/authoring/:id/sections/:sectionId/regenerate', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const { id, sectionId } = c.req.param();
  const body = await c.req.json<{ steer?: string }>().catch(() => ({ steer: undefined }));

  try {
    const res = await fetch(`${relayUrl()}/internal/tender/section/regenerate`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId: id, tenantId, sectionId, steer: body.steer }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return c.json({ error: `Relay error ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Clause library ────────────────────────────────────────────────────────────

tenderAuthoringRoutes.get('/clause-library', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  await ensureClauseLibrary(tenantId);
  const rows = await db.select().from(clauseLibrary)
    .where(and(eq(clauseLibrary.tenantId, tenantId), eq(clauseLibrary.isActive, true)));
  return c.json(rows);
});

tenderAuthoringRoutes.post('/clause-library', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const body = await c.req.json<{ code?: string; category: string; title: string; content: string; tags?: string[] }>();
  if (!body.category || !body.title || !body.content) return c.json({ error: 'category, title, content required' }, 400);

  const code = body.code ?? `CL-${String(Date.now()).slice(-4)}`;
  const [row] = await db.insert(clauseLibrary).values({ tenantId, code, category: body.category, title: body.title, content: body.content, tags: body.tags ?? [] }).returning();
  return c.json(row);
});

// ── Export (HTML → Word/PDF) ──────────────────────────────────────────────────

tenderAuthoringRoutes.get('/authoring/:id/export', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const id = c.req.param('id');
  const fmt = c.req.query('format') ?? 'html';

  const [tender] = await db.select().from(tenders).where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);
  const sections = await db.select().from(rfpSections).where(and(eq(rfpSections.tenderId, id), eq(rfpSections.tenantId, tenantId))).orderBy(asc(rfpSections.sectionNo));

  const filename = tender.rfpNumber.replace(/\//g, '-');
  if (fmt === 'word') {
    const html = buildWordDoc(tender as any, sections as any);
    c.header('Content-Type', 'application/msword');
    c.header('Content-Disposition', `attachment; filename="${filename}.doc"`);
    return c.body(html);
  }
  const html = buildExportHtml(tender, sections);
  c.header('Content-Type', 'text/html');
  c.header('Content-Disposition', `attachment; filename="${filename}.html"`);
  return c.body(html);
});

// ── Publish ───────────────────────────────────────────────────────────────────

tenderAuthoringRoutes.post('/authoring/:id/publish', async (c) => {
  const rc = c.get('requestContext') as any;
  const tenantId = rc?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const id = c.req.param('id');
  const [tender] = await db.select().from(tenders).where(and(eq(tenders.id, id), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);
  if (tender.status === 'published') return c.json({ error: 'already published' }, 409);
  const secs = await db.select({ acceptedAt: rfpSections.acceptedAt }).from(rfpSections)
    .where(and(eq(rfpSections.tenderId, id), eq(rfpSections.tenantId, tenantId)));
  if (!secs.length || secs.some((s: { acceptedAt: Date | null }) => !s.acceptedAt))
    return c.json({ error: `All ${secs.length} sections must be accepted before publishing` }, 422);
  const now = new Date();
  const tf = (tender.templateFields ?? {}) as Record<string, unknown>;
  await db.update(tenders)
    .set({ status: 'published', publishedAt: now, templateFields: { ...tf, publishedBy: userId }, updatedAt: now })
    .where(eq(tenders.id, id));
  await db.insert(auditLog).values({ tenantId, actorId: userId, actorType: 'human', action: 'tender_publish', resource: 'tender', resourceId: id, metadata: { rfpNumber: tender.rfpNumber, sectionCount: secs.length }, traceId: (c.get('traceId') as string | undefined) ?? '' });
  return c.json({ ok: true, publishedAt: now.toISOString() });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildExportHtml(tender: any, sections: any[]): string {
  const sectionHtml = sections.map(s => {
    const content = (s.content ?? {}) as any;
    let body = '';
    if (s.blockType === 'prose') {
      body = `<p>${(content.text ?? '').replace(/\n/g, '</p><p>')}</p>`;
    } else if (s.blockType === 'criteria-table') {
      const rows = (content.rows ?? []).map((r: any) => `<tr><td>${r.criterion}</td><td>${r.threshold}</td><td>${r.verification}</td></tr>`).join('');
      body = `<table border="1" cellpadding="6"><thead><tr><th>Criterion</th><th>Threshold</th><th>Verification</th></tr></thead><tbody>${rows}</tbody></table>`;
    } else if (s.blockType === 'spec-table') {
      const rows = (content.rows ?? []).map((r: any) => `<tr><td>${r.metric}</td><td>${r.target}</td><td>${r.measurement}</td></tr>`).join('');
      body = `<table border="1" cellpadding="6"><thead><tr><th>Metric</th><th>Target</th><th>Measurement</th></tr></thead><tbody>${rows}</tbody></table>`;
    } else if (s.blockType === 'line-item-table') {
      const rows = (content.rows ?? []).map((r: any) => `<tr><td>${r.slNo}</td><td>${r.item}</td><td>${r.unit}</td><td>${r.qty}</td><td>${r.remarks ?? ''}</td></tr>`).join('');
      body = `<table border="1" cellpadding="6"><thead><tr><th>S.No</th><th>Item</th><th>Unit</th><th>Qty</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return `<h2>${s.sectionNo}. ${s.title}</h2>${body}`;
  }).join('<hr/>');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tender.rfpNumber}</title><style>body{font-family:Arial,sans-serif;margin:40px;font-size:12pt}h1{text-align:center}h2{margin-top:24px}table{border-collapse:collapse;width:100%}td,th{padding:6px;border:1px solid #666;font-size:11pt}</style></head><body><h1>${tender.rfpNumber}</h1><h2 style="text-align:center">${tender.title}</h2><p style="text-align:center">${tender.department}</p><hr/>${sectionHtml}</body></html>`;
}

async function ensureClauseLibrary(tenantId: string): Promise<void> {
  const [existing] = await db.select({ id: clauseLibrary.id }).from(clauseLibrary).where(eq(clauseLibrary.tenantId, tenantId)).limit(1);
  if (existing) return;
  await db.insert(clauseLibrary).values(SEED_CLAUSES.map(c => ({ ...c, tenantId })));
}

