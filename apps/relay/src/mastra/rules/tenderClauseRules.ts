import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export interface MandatoryClause {
  clauseNo: string
  libraryRef: string
  title: string
  reason: string
}

export interface AnnexureSpec {
  sectionNo: string
  title: string
  libraryRef: string
}

interface RawMandatoryRule {
  id: string; clauseNo: string; libraryRef: string; title: string
  categories: string[] | null; minValueInr: number; reason: string
}
interface RawAnnexureEntry { sectionNo: string; title: string; libraryRef: string }
interface RawRules {
  mandatoryClauses: RawMandatoryRule[]
  annexureSets: Record<string, RawAnnexureEntry[]>
  commercialAnnexure: RawAnnexureEntry
}

const RULES_PATH = process.env.TENDER_CLAUSE_RULES_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../ai-service/rules/tender/tender_clause_rules.json')

let cached: RawRules | null = null
function loadRules(): RawRules {
  if (!cached) cached = JSON.parse(readFileSync(RULES_PATH, 'utf8')) as RawRules
  return cached
}

export function normalizeCategory(rawCategory: unknown): 'goods' | 'services' | 'works' {
  const s = String(rawCategory ?? '').toLowerCase()
  if (s.includes('goods') || s.includes('supply') || s.includes('equipment')) return 'goods'
  if (s.includes('works') || s.includes('construction') || s.includes('civil')) return 'works'
  return 'services'
}

export function computeApplicableClauses(
  tender: { budget: string | null },
  templateFields: Record<string, unknown>
): { mandatory: MandatoryClause[]; annexures: AnnexureSpec[] } {
  const rules = loadRules()
  const category = normalizeCategory(templateFields.category)
  const estimatedValueInr = tender.budget ? Number(tender.budget) : 0

  const mandatory: MandatoryClause[] = rules.mandatoryClauses
    .filter(rule => {
      const categoryOk = rule.categories === null || rule.categories.includes(category)
      const valueOk = estimatedValueInr >= rule.minValueInr
      return categoryOk && valueOk
    })
    .map(rule => ({ clauseNo: rule.clauseNo, libraryRef: rule.libraryRef, title: rule.title, reason: rule.reason }))

  const annexures: AnnexureSpec[] = [
    ...(rules.annexureSets[category] ?? []),
    rules.commercialAnnexure,
  ].map(a => ({ sectionNo: a.sectionNo, title: a.title, libraryRef: a.libraryRef }))

  return { mandatory, annexures }
}

export interface RfpSectionLike {
  sectionNo: string
  title: string
  blockType: string
  content: Record<string, unknown>
}

export interface LibraryRowLike {
  code: string
  title: string
  content: string
}

export function enforceRequiredClauses(
  sections: RfpSectionLike[],
  mandatory: MandatoryClause[],
  libraryRows: LibraryRowLike[]
): RfpSectionLike[] {
  const libraryByCode = new Map(libraryRows.map(r => [r.code, r]))

  return sections.map(section => {
    if (section.sectionNo !== 'S8') return section

    const content = section.content as { text?: string; clauses?: Array<{ clauseNo: string; libraryRef?: string | null }> }
    const existingClauses = content.clauses ?? []
    const presentNos = new Set(existingClauses.map(c => c.clauseNo))
    const presentRefs = new Set(existingClauses.filter(c => c.libraryRef).map(c => c.libraryRef))

    const toAdd = mandatory.filter(m => !presentNos.has(m.clauseNo) && !presentRefs.has(m.libraryRef))
    if (toAdd.length === 0) return section

    const patchedClauses = [...existingClauses]
    for (const m of toAdd) {
      const libraryRow = libraryByCode.get(m.libraryRef)
      if (!libraryRow) {
        console.warn(`[tenderClauseRules] mandatory clause ${m.clauseNo} references unknown library code ${m.libraryRef} — skipped`)
        continue
      }
      patchedClauses.push({
        clauseNo: m.clauseNo, title: libraryRow.title, text: libraryRow.content,
        source: 'library', libraryRef: m.libraryRef,
      } as unknown as { clauseNo: string; libraryRef?: string | null })
    }

    return { ...section, content: { ...content, clauses: patchedClauses } }
  })
}
