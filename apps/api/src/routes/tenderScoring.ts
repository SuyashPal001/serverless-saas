import { Hono } from 'hono';
import { db } from '@serverless-saas/database';
import {
  tenders, technicalFindings, bidderTechnicalScores,
} from '@serverless-saas/database/schema/tender';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

// ── Status scoring factors ────────────────────────────────────────────────────

const STATUS_FACTORS: Record<string, number> = {
  complied: 1.0,
  deviation: 0.5,
  not_found: 0.0,
  cannot_evaluate: 0.0,
};

// ── Pure scoring function ─────────────────────────────────────────────────────

type Finding = { bidderId: string; clauseNo: string; status: string };
type BreakdownRow = { clauseNo: string; weight: number; status: string; points: number };
type BidderScore = { bidderId: string; technicalScore: number; breakdown: BreakdownRow[] };

export function computeTechnicalScores(
  findings: Finding[],
  weights: Record<string, number>,
): BidderScore[] {
  const bidderMap = new Map<string, Map<string, string>>();
  for (const f of findings) {
    if (!bidderMap.has(f.bidderId)) bidderMap.set(f.bidderId, new Map());
    bidderMap.get(f.bidderId)!.set(f.clauseNo, f.status);
  }

  const results: BidderScore[] = [];
  for (const [bidderId, clauseStatuses] of bidderMap) {
    const breakdown: BreakdownRow[] = [];
    let total = 0;
    for (const [clauseNo, weight] of Object.entries(weights)) {
      const status = clauseStatuses.get(clauseNo) ?? 'not_found';
      const factor = STATUS_FACTORS[status] ?? 0;
      const points = parseFloat((weight * factor).toFixed(4));
      total += points;
      breakdown.push({ clauseNo, weight, status, points });
    }
    results.push({
      bidderId,
      technicalScore: parseFloat(total.toFixed(4)),
      breakdown,
    });
  }
  return results;
}

// ── Equal-weight helper ───────────────────────────────────────────────────────

export function equalWeights(clauseNos: string[]): Record<string, number> {
  if (clauseNos.length === 0) return {};
  const base = parseFloat((100 / clauseNos.length).toFixed(2));
  const weights: Record<string, number> = {};
  let assigned = 0;
  for (let i = 0; i < clauseNos.length - 1; i++) {
    weights[clauseNos[i]] = base;
    assigned = parseFloat((assigned + base).toFixed(2));
  }
  // Last entry absorbs rounding error so sum === 100 exactly
  weights[clauseNos[clauseNos.length - 1]] = parseFloat((100 - assigned).toFixed(2));
  return weights;
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

async function upsertScores(
  tenantId: string,
  tenderId: string,
  scores: BidderScore[],
): Promise<void> {
  await db.delete(bidderTechnicalScores)
    .where(and(eq(bidderTechnicalScores.tenderId, tenderId), eq(bidderTechnicalScores.tenantId, tenantId)));

  if (scores.length === 0) return;
  await db.insert(bidderTechnicalScores).values(
    scores.map(s => ({
      tenantId,
      tenderId,
      bidderId: s.bidderId,
      technicalScore: String(s.technicalScore),
      breakdown: s.breakdown,
    })),
  );
}

// ── Auto-seed helper ─────────────────────────────────────────────────────────
// Called from GET /evaluations/:id to transparently seed equal weights when
// scoring_config is absent or doesn't cover all current technical clauses.

type RawFinding = { bidderId: string; clauseNo: string; status: unknown };

export async function ensureScoresSeeded(
  tenantId: string,
  tenderId: string,
  rawFindings: RawFinding[],
  config: { weights?: Record<string, number> } | null,
): Promise<Array<{ bidderId: string; technicalScore: string; breakdown: unknown[] }>> {
  if (rawFindings.length === 0) return [];

  const allClauseNos = [...new Set(rawFindings.map(f => f.clauseNo))].sort();
  let weights = config?.weights ?? {};

  // Refresh when weights are empty or don't cover all current clauses
  const needsRefresh = Object.keys(weights).length === 0
    || allClauseNos.some(c => !(c in weights));

  if (needsRefresh) {
    weights = equalWeights(allClauseNos);
    await db.update(tenders)
      .set({ scoringConfig: { weights }, updatedAt: new Date() })
      .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  }

  const typedFindings: Finding[] = rawFindings.map(f => ({
    bidderId: f.bidderId,
    clauseNo: f.clauseNo,
    status: String(f.status),
  }));
  const scores = computeTechnicalScores(typedFindings, weights);
  await upsertScores(tenantId, tenderId, scores);
  return scores.map(s => ({
    bidderId: s.bidderId,
    technicalScore: String(s.technicalScore),
    breakdown: s.breakdown,
  }));
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const tenderScoringRoutes = new Hono<AppEnv>();

// PUT /tender/evaluations/:id/scoring-config
tenderScoringRoutes.put('/evaluations/:id/scoring-config', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const userId = c.get('userId') as string;
  const tenderId = c.req.param('id');

  const body = await c.req.json<{ weights: Record<string, number> }>().catch(() => null);
  if (!body?.weights || typeof body.weights !== 'object') {
    return c.json({ error: 'weights object required' }, 400);
  }

  const weights = body.weights;
  const values = Object.values(weights);
  if (values.some(v => typeof v !== 'number' || v < 0)) {
    return c.json({ error: 'all weights must be non-negative numbers' }, 400);
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return c.json({ error: `weights must sum to 100 (got ${sum.toFixed(4)})` }, 400);
  }

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  await db.update(tenders)
    .set({ scoringConfig: { weights }, updatedAt: new Date() })
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));

  const rawFindings = await db.select({
    bidderId: technicalFindings.bidderId,
    clauseNo: technicalFindings.clauseNo,
    status: technicalFindings.status,
  }).from(technicalFindings).where(eq(technicalFindings.tenderId, tenderId));

  type RawFinding = { bidderId: string; clauseNo: string; status: unknown };
  const typedFindings: Finding[] = (rawFindings as RawFinding[]).map(f => ({
    bidderId: f.bidderId,
    clauseNo: f.clauseNo,
    status: String(f.status),
  }));
  const scores = computeTechnicalScores(typedFindings, weights);
  await upsertScores(tenantId, tenderId, scores);

  db.insert(auditLog).values({
    tenantId,
    actorId: userId ?? 'system',
    actorType: 'human',
    action: 'tender_scoring_config_updated',
    resource: 'tender',
    resourceId: tenderId,
    metadata: {
      weights,
      perBidderScores: scores.map(s => ({ bidderId: s.bidderId, technicalScore: s.technicalScore })),
    },
    traceId: (c.get('traceId') as string | undefined) ?? '',
  }).catch((err: unknown) => console.error('[tenderScoring] audit write failed:', err));

  return c.json({ ok: true, scores });
});

// POST /tender/evaluations/:id/technical/score — recompute with stored weights
tenderScoringRoutes.post('/evaluations/:id/technical/score', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id as string;
  const tenderId = c.req.param('id');

  const [tender] = await db.select().from(tenders)
    .where(and(eq(tenders.id, tenderId), eq(tenders.tenantId, tenantId)));
  if (!tender) return c.json({ error: 'not found' }, 404);

  const config = tender.scoringConfig as { weights?: Record<string, number> } | null;
  const findings = await db.select({
    bidderId: technicalFindings.bidderId,
    clauseNo: technicalFindings.clauseNo,
    status: technicalFindings.status,
  }).from(technicalFindings).where(eq(technicalFindings.tenderId, tenderId));

  type RawFinding2 = { bidderId: string; clauseNo: string; status: unknown };
  const rawFindings2 = findings as RawFinding2[];

  let weights = config?.weights ?? {};
  if (Object.keys(weights).length === 0 && findings.length > 0) {
    const clauseSet = new Set<string>(rawFindings2.map(f => f.clauseNo));
    const clauseNos = [...clauseSet].sort();
    weights = equalWeights(clauseNos);
  }

  const typedFindings: Finding[] = rawFindings2.map(f => ({
    bidderId: f.bidderId,
    clauseNo: f.clauseNo,
    status: String(f.status),
  }));
  const scores = computeTechnicalScores(typedFindings, weights);
  await upsertScores(tenantId, tenderId, scores);

  return c.json({ ok: true, scores });
});
