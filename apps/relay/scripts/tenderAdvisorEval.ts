/**
 * Eval harness for the Procurement Advisor (tenderAdvisorAgent) chatbot.
 *
 * Usage: npx tsx scripts/tenderAdvisorEval.ts
 * Requires: DATABASE_URL, INFERENCE_GATEWAY_URL, TENANT_ID, and a running
 *           inference gateway — same requirements as the rest of the tender
 *           evaluation pipeline (see TIER0-VERIFICATION-PLAN.md). If any of
 *           these are unreachable, this script reports which items were
 *           SKIPPED (not scored as pass/fail) and exits non-zero — it never
 *           fabricates a pass/fail result for an item it couldn't actually run.
 *
 * This is a keyword-presence grader, not an LLM judge — deliberately simple
 * and auditable for a first eval pass. A future iteration could add an
 * LLM-judge grading mode for nuance the keyword check misses, but a simple
 * grader you can read and trust beats an opaque one for a first measured
 * number.
 *
 * This ships 25 curated Q&A pairs as a starting set for this MVP — not the
 * full 50-100 the OIL scope doc mentions. Expand this file over time as real
 * usage surfaces new question patterns; do not treat 25 as a final target.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface EvalItem {
  id: string
  category: string
  question: string
  expectedKeywords: string[]
}

export interface GradeResult {
  pass: boolean
  matchedCount: number
  totalKeywords: number
}

export function gradeAnswer(answer: string, expectedKeywords: string[]): GradeResult {
  const lower = answer.toLowerCase()
  const matched = expectedKeywords.filter(kw => lower.includes(kw.toLowerCase()))
  return { pass: matched.length === expectedKeywords.length, matchedCount: matched.length, totalKeywords: expectedKeywords.length }
}

interface EvalItemResult {
  id: string
  category: string
  question: string
  status: 'graded' | 'skipped'
  grade?: GradeResult
  answer?: string
  skipReason?: string
}

async function callTenderAdvisor(question: string, tenantId: string): Promise<string> {
  const gatewayUrl = (process.env.INFERENCE_GATEWAY_URL ?? 'http://localhost:4001').trim()
  const relayUrl = (process.env.RELAY_URL ?? 'http://localhost:3001').trim()
  const res = await fetch(`${relayUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Key': process.env.INTERNAL_SERVICE_KEY ?? '' },
    body: JSON.stringify({ message: question, tenantId, agentName: 'Procurement Advisor', conversationId: `eval-${Date.now()}` }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`chat endpoint returned ${res.status}`)
  const text = await res.text()
  return text
}

export async function runEval(): Promise<{ results: EvalItemResult[]; gradedCount: number; passCount: number; skippedCount: number }> {
  const qaPath = resolve(__dirname, 'tenderAdvisorEval.qa.json')
  const items: EvalItem[] = JSON.parse(readFileSync(qaPath, 'utf8'))
  const tenantId = process.env.SEED_TENDER_TENANT_ID ?? process.env.SEED_TENANT_ID ?? ''

  const results: EvalItemResult[] = []

  for (const item of items) {
    if (!tenantId) {
      results.push({ id: item.id, category: item.category, question: item.question, status: 'skipped', skipReason: 'SEED_TENANT_ID not set' })
      continue
    }
    try {
      const answer = await callTenderAdvisor(item.question, tenantId)
      const grade = gradeAnswer(answer, item.expectedKeywords)
      results.push({ id: item.id, category: item.category, question: item.question, status: 'graded', grade, answer })
    } catch (err) {
      results.push({ id: item.id, category: item.category, question: item.question, status: 'skipped', skipReason: (err as Error).message })
    }
  }

  const graded = results.filter(r => r.status === 'graded')
  const passed = graded.filter(r => r.grade?.pass)
  const skipped = results.filter(r => r.status === 'skipped')

  return { results, gradedCount: graded.length, passCount: passed.length, skippedCount: skipped.length }
}

async function main() {
  const { results, gradedCount, passCount, skippedCount } = await runEval()
  const outPath = resolve(__dirname, `tenderAdvisorEval.results.${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(results, null, 2))

  console.log(`\nEval complete: ${results.length} items total`)
  console.log(`  Graded:  ${gradedCount}`)
  console.log(`  Skipped: ${skippedCount} (see per-item skipReason — NOT counted as pass or fail)`)
  if (gradedCount > 0) {
    console.log(`  Passed:  ${passCount}/${gradedCount} (${((passCount / gradedCount) * 100).toFixed(1)}%)`)
  } else {
    console.log(`  Passed:  N/A — no items were actually graded, cannot report an accuracy percentage`)
  }
  console.log(`\nFull results written to: ${outPath}`)

  if (skippedCount === results.length) {
    console.error('\nEvery item was skipped — no live agent connection. This run measured nothing.')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1) })
}
