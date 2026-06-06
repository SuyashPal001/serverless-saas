import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import { tenders } from '@serverless-saas/database/schema/tender';
import { clauseLibrary, rfpSections, rfpSectionVersions } from '@serverless-saas/database/schema/tender-authoring';
import { eq, and, asc } from 'drizzle-orm';
import type { AppEnv } from '../types';

const RELAY_URL = (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const INTERNAL_KEY = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

function relayHeaders() {
  return { 'Content-Type': 'application/json', ...(INTERNAL_KEY ? { 'x-internal-service-key': INTERNAL_KEY } : {}) };
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

  // Fire and await relay — synchronous for demo (120s timeout)
  try {
    const res = await fetch(`${RELAY_URL}/internal/tender/author`, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify({ tenderId: tender.id, tenantId }),
      signal: AbortSignal.timeout(120_000),
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
    const res = await fetch(`${RELAY_URL}/internal/tender/section/regenerate`, {
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

  const html = buildExportHtml(tender, sections);
  if (fmt === 'word') {
    c.header('Content-Type', 'application/vnd.ms-word');
    c.header('Content-Disposition', `attachment; filename="${tender.rfpNumber.replace(/\//g, '-')}.doc"`);
  } else {
    c.header('Content-Type', 'text/html');
    c.header('Content-Disposition', `attachment; filename="${tender.rfpNumber.replace(/\//g, '-')}.html"`);
  }
  return c.body(html);
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

const SEED_CLAUSES = [
  { code: 'CL-001', category: 'Eligibility/PQ', title: 'Annual Turnover Threshold', content: 'The bidder shall have an average annual turnover of not less than ₹5 Crore (Rupees Five Crore) during the last three completed financial years, duly certified by a Chartered Accountant.', tags: ['financial', 'eligibility'] },
  { code: 'CL-002', category: 'Eligibility/PQ', title: 'Similar Work Experience', content: 'The bidder shall have successfully completed at least one similar work of value not less than 50% of the estimated contract value during the last 7 years. "Similar work" means implementation of an IT/software system for a Government or PSU entity.', tags: ['experience', 'eligibility'] },
  { code: 'CL-003', category: 'Eligibility/PQ', title: 'Years in Existence', content: 'The bidder shall have been in existence and conducting business for a minimum period of 5 years as on the date of submission of bid, evidenced by Certificate of Incorporation.', tags: ['existence', 'eligibility'] },
  { code: 'CL-004', category: 'Eligibility/PQ', title: 'No Debarment / Blacklisting', content: 'The bidder shall not have been debarred, blacklisted, or banned from doing business by any Government Ministry, Department, PSU, or regulatory authority in India. A self-declaration on company letterhead is mandatory.', tags: ['compliance', 'eligibility'] },
  { code: 'CL-005', category: 'Technical', title: 'System Availability SLA', content: 'The system shall be available on a 24×7×365 basis with a minimum uptime of 99.5% measured on a monthly basis, excluding pre-approved planned maintenance windows.', tags: ['sla', 'uptime', 'technical'] },
  { code: 'CL-006', category: 'Technical', title: 'Encryption in Transit', content: 'All data transmitted between client and server shall be encrypted using TLS 1.2 or higher. The use of deprecated protocols (SSL, TLS 1.0, TLS 1.1) is strictly prohibited.', tags: ['security', 'encryption', 'technical'] },
  { code: 'CL-007', category: 'Technical', title: 'Data Residency — India', content: 'All data, including backups, logs, and processing, shall be stored and processed within the territory of India on data centres empanelled by MeitY or owned by the vendor.', tags: ['data-residency', 'compliance', 'technical'] },
  { code: 'CL-008', category: 'Technical', title: 'Disaster Recovery (RTO/RPO)', content: 'The vendor shall maintain a Disaster Recovery (DR) setup with Recovery Time Objective (RTO) of not more than 4 hours and Recovery Point Objective (RPO) of not more than 1 hour for all critical data.', tags: ['dr', 'rto', 'rpo', 'technical'] },
  { code: 'CL-009', category: 'SLA/KPI', title: 'Response Time — Web Transactions', content: 'The application shall respond to 95% of standard web transactions within 3 seconds under normal load conditions (up to 200 concurrent users). Load test reports shall be submitted at UAT stage.', tags: ['performance', 'response-time', 'sla'] },
  { code: 'CL-010', category: 'SLA/KPI', title: 'Critical Incident Resolution', content: 'Critical incidents (P1 — system down or data loss risk) shall be acknowledged within 30 minutes and resolved within 4 hours. The vendor shall provide 24×7 L2 support coverage.', tags: ['incident', 'support', 'sla'] },
  { code: 'CL-011', category: 'SLA/KPI', title: 'Planned Maintenance Window', content: 'Planned maintenance shall be restricted to the approved maintenance window of 00:00 to 05:00 hours IST. A minimum 5 working days advance notice shall be provided for any planned downtime.', tags: ['maintenance', 'sla'] },
  { code: 'CL-012', category: 'SLA/KPI', title: 'Monthly Uptime Reporting', content: 'The vendor shall submit a Monthly SLA Compliance Report within 5 working days of the end of each calendar month. The report shall include uptime percentage, incident log, and penalty calculation if applicable.', tags: ['reporting', 'sla'] },
  { code: 'CL-013', category: 'Commercial', title: 'Payment Schedule', content: 'Payment shall be released in tranches: 30% upon delivery and installation; 40% upon successful User Acceptance Testing (UAT) sign-off; 30% upon go-live and completion of training.', tags: ['payment', 'commercial'] },
  { code: 'CL-014', category: 'Commercial', title: 'Liquidated Damages for Delay', content: 'In the event of delay in delivery beyond the scheduled date, Liquidated Damages (LD) shall be levied at 0.5% of the contract value per week of delay, subject to a maximum of 10% of the total contract value.', tags: ['ld', 'penalty', 'commercial'] },
  { code: 'CL-015', category: 'Commercial', title: 'Performance Bank Guarantee', content: 'The successful bidder shall furnish a Performance Bank Guarantee (PBG) equivalent to 10% of the contract value within 15 days of issue of Letter of Award. The PBG shall remain valid until 60 days beyond the warranty period.', tags: ['pbg', 'guarantee', 'commercial'] },
  { code: 'CL-016', category: 'Security/Compliance', title: 'ISO 27001 Certification', content: 'The vendor shall hold a valid ISO 27001:2022 certification for Information Security Management System (ISMS) covering the systems and processes relevant to this project. Certificate shall be submitted with the technical bid.', tags: ['iso27001', 'security'] },
  { code: 'CL-017', category: 'Security/Compliance', title: 'Annual Penetration Testing', content: 'The system shall undergo an independent third-party VAPT (Vulnerability Assessment and Penetration Testing) at least once per year. The VAPT report along with remediation closure evidence shall be submitted to the Department within 30 days of testing.', tags: ['vapt', 'pentest', 'security'] },
  { code: 'CL-018', category: 'Security/Compliance', title: 'Audit Trail Retention', content: 'The system shall maintain tamper-evident audit logs of all user actions, system events, and data modifications. Audit logs shall be retained for a minimum period of 7 years and made available to Government auditors upon request.', tags: ['audit', 'retention', 'compliance'] },
  { code: 'CL-019', category: 'General Terms', title: 'Governing Law and Dispute Resolution', content: 'This contract shall be governed by the laws of India. All disputes arising out of this contract shall be settled through arbitration under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be New Delhi.', tags: ['legal', 'arbitration', 'general'] },
  { code: 'CL-020', category: 'General Terms', title: 'Intellectual Property Rights', content: 'All intellectual property, including but not limited to source code, documentation, designs, and data generated under this contract, shall vest absolutely with the Government of India. The vendor shall not claim any proprietary rights over deliverables.', tags: ['ip', 'ipr', 'general'] },
];
