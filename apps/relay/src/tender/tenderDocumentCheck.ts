// apps/relay/src/tender/tenderDocumentCheck.ts
import { db, rfpSections, documentChecks } from '@serverless-saas/database'
import { eq, and } from 'drizzle-orm'
import { evaluateStructuralChecks, type SectionState } from '../mastra/rules/tenderDocumentCheckRules.js'
import { tenderDocumentCheckerAgent } from '../mastra/agents/tenderDocumentCheckerAgent.js'
import { writeTenderAuditLog } from '../mastra/workflows/tenderAuditLog.js'

export interface DocumentCheckSummary {
  structuralResults: { ruleId: string; sectionNo: string; status: 'pass' | 'fail'; message: string }[]
  conflictCount: number
  passCount: number
  failCount: number
}

interface RfpSectionRow {
  sectionNo: string
  title: string
  blockType: string
  content: unknown
  acceptedAt: Date | null
}

interface RfpClause { clauseNo?: string; title?: string; text?: string; source?: string; libraryRef?: string | null }

function sectionHasContent(row: RfpSectionRow): boolean {
  const content = row.content as { text?: string; rows?: unknown[]; clauses?: unknown[] } | null
  if (!content) return false
  if (typeof content.text === 'string' && content.text.trim().length > 0) return true
  if (Array.isArray(content.rows) && content.rows.length > 0) return true
  if (Array.isArray(content.clauses) && content.clauses.length > 0) return true
  return false
}

function sectionText(row: RfpSectionRow): string {
  const content = row.content as { text?: string; rows?: Array<Record<string, unknown>>; clauses?: RfpClause[] } | null
  if (!content) return ''
  const parts: string[] = []
  if (typeof content.text === 'string' && content.text.trim().length > 0) parts.push(content.text)
  if (Array.isArray(content.rows) && content.rows.length > 0) {
    parts.push(content.rows.map(r => JSON.stringify(r)).join('\n'))
  }
  if (Array.isArray(content.clauses) && content.clauses.length > 0) {
    parts.push(content.clauses.map(c => `${c.clauseNo ?? ''} ${c.title ?? ''}: ${c.text ?? ''}`.trim()).join('\n'))
  }
  return parts.join('\n')
}

interface AgentConflict { sectionA: string; sectionB: string; description: string; severity: string }

async function findClauseConflicts(sections: RfpSectionRow[]): Promise<AgentConflict[]> {
  const accepted = sections.filter(s => s.acceptedAt != null && sectionHasContent(s))
  if (accepted.length < 2) return []

  const combined = accepted
    .map(s => `--- ${s.sectionNo}: ${s.title} ---\n${sectionText(s)}`)
    .join('\n\n')
    .slice(0, 12000)

  try {
    const result = await tenderDocumentCheckerAgent.generate(combined)
    const raw = (result.text ?? '').trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return []
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { conflicts?: AgentConflict[] }
    return Array.isArray(parsed.conflicts) ? parsed.conflicts : []
  } catch (err) {
    console.error('[documentCheck] clause-conflict check failed:', (err as Error).message)
    return []
  }
}

export async function runDocumentCheck(tenderId: string, tenantId: string): Promise<DocumentCheckSummary> {
  const sections = await db.select().from(rfpSections).where(
    and(eq(rfpSections.tenderId, tenderId), eq(rfpSections.tenantId, tenantId))
  ) as RfpSectionRow[]

  // Idempotent re-run: wipe prior results for this tender first (same pattern as financialEvaluate.ts)
  await db.delete(documentChecks).where(eq(documentChecks.tenderId, tenderId))

  const sectionStates: SectionState[] = sections.map(s => ({
    sectionNo: s.sectionNo,
    present: true,
    accepted: s.acceptedAt != null,
    hasContent: sectionHasContent(s),
    title: s.title,
  }))
  const structuralResults = evaluateStructuralChecks(sectionStates)

  await db.insert(documentChecks).values(
    structuralResults.map(r => ({
      tenantId, tenderId, checkType: 'structural' as const,
      ruleId: r.ruleId, status: r.status === 'pass' ? ('pass' as const) : ('fail' as const),
      sectionNo: r.sectionNo, message: r.message, detail: {},
    }))
  )

  const conflicts = await findClauseConflicts(sections)
  if (conflicts.length > 0) {
    await db.insert(documentChecks).values(
      conflicts.map((c, i) => ({
        tenantId, tenderId, checkType: 'clause_conflict' as const,
        ruleId: `CONFLICT-${i + 1}`, status: 'flagged' as const,
        sectionNo: c.sectionA, message: c.description,
        detail: { sectionA: c.sectionA, sectionB: c.sectionB, severity: c.severity },
      }))
    )
  }

  await writeTenderAuditLog({
    tenantId, actorId: 'system', action: 'document_checked', resource: 'tender', resourceId: tenderId,
    metadata: {
      structuralPass: structuralResults.filter(r => r.status === 'pass').length,
      structuralFail: structuralResults.filter(r => r.status === 'fail').length,
      conflictsFound: conflicts.length,
    },
  })

  return {
    structuralResults,
    conflictCount: conflicts.length,
    passCount: structuralResults.filter(r => r.status === 'pass').length,
    failCount: structuralResults.filter(r => r.status === 'fail').length,
  }
}
