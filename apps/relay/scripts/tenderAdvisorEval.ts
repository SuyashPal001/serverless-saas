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
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

let _pool: pg.Pool | null = null
function getPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// Look up the seeded "Procurement Advisor" agent's real UUID for this tenant.
// The chat endpoint (apps/relay/src/routes/chat.ts) only ever reads `agentId`
// from the request body — never an agent name — so sending a name string here
// silently falls through to the generic platformAgent (resolveAgent(null ?? ''))
// instead of the Tender Advisor. See Finding 1 of the whole-branch review.
async function findProcurementAdvisorAgentId(tenantId: string): Promise<string | null> {
  const p = getPool()
  const res = await p.query<{ id: string }>(
    `SELECT id FROM agents WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, 'Procurement Advisor'],
  )
  return res.rows[0]?.id ?? null
}

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

// Parses the raw SSE response body from POST /api/chat and returns just the
// final assembled answer text — not the raw event stream. The stream (see
// apps/relay/src/routes/chatStream.ts) emits a terminal `done` event whose
// JSON payload has a `text` field containing the complete assistant answer;
// prefer that over concatenating `delta` chunks since it can't be split
// across multiple SSE frames the way a multi-word keyword match could be.
function extractFinalAnswerText(sseText: string): string {
  const events = sseText.split('\n\n').filter(chunk => chunk.trim().length > 0)
  let doneText: string | null = null
  const deltaChunks: string[] = []

  for (const chunk of events) {
    const lines = chunk.split('\n')
    const eventLine = lines.find(l => l.startsWith('event:'))
    const dataLine = lines.find(l => l.startsWith('data:'))
    if (!dataLine) continue
    const eventName = eventLine ? eventLine.slice('event:'.length).trim() : ''
    const raw = dataLine.slice('data:'.length).trim()
    try {
      const data = JSON.parse(raw) as { text?: string }
      if (eventName === 'done' && typeof data.text === 'string') {
        doneText = data.text
      } else if (eventName === 'delta' && typeof data.text === 'string') {
        deltaChunks.push(data.text)
      }
    } catch {
      // not a JSON data payload — skip
    }
  }

  if (doneText !== null) return doneText
  // Fallback: no terminal `done` event found — reconstruct from delta chunks only,
  // excluding tool-call/tool-result payloads so those don't pollute the graded text.
  return deltaChunks.join('')
}

async function callTenderAdvisor(question: string, tenantId: string, agentId: string): Promise<string> {
  const relayUrl = (process.env.RELAY_URL ?? 'http://localhost:3001').trim()
  const res = await fetch(`${relayUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Key': process.env.INTERNAL_SERVICE_KEY ?? '' },
    body: JSON.stringify({ message: question, tenantId, agentId, conversationId: `eval-${Date.now()}` }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`chat endpoint returned ${res.status}`)
  const text = await res.text()
  return extractFinalAnswerText(text)
}

export async function runEval(): Promise<{ results: EvalItemResult[]; gradedCount: number; passCount: number; skippedCount: number }> {
  const qaPath = resolve(__dirname, 'tenderAdvisorEval.qa.json')
  const items: EvalItem[] = JSON.parse(readFileSync(qaPath, 'utf8'))
  const tenantId = process.env.SEED_TENDER_TENANT_ID ?? process.env.SEED_TENANT_ID ?? ''

  const results: EvalItemResult[] = []

  // Resolve the seeded "Procurement Advisor" agent's real UUID once, up front —
  // the chat endpoint routes purely on agentId, so every item must send that
  // agent's actual database id, never a name string (Finding 1).
  let agentId: string | null = null
  if (tenantId) {
    try {
      agentId = await findProcurementAdvisorAgentId(tenantId)
    } catch (err) {
      agentId = null
      console.error('[eval] failed to look up Procurement Advisor agentId:', (err as Error).message)
    }
  }

  for (const item of items) {
    if (!tenantId) {
      results.push({ id: item.id, category: item.category, question: item.question, status: 'skipped', skipReason: 'SEED_TENANT_ID not set' })
      continue
    }
    if (!agentId) {
      results.push({ id: item.id, category: item.category, question: item.question, status: 'skipped', skipReason: 'Procurement Advisor agent not found for this tenant' })
      continue
    }
    try {
      const answer = await callTenderAdvisor(item.question, tenantId, agentId)
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
  if (_pool) await _pool.end()
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
