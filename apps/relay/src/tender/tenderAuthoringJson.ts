/**
 * Extract the first complete {...} JSON object from model output.
 * Strips markdown fences, then uses brace-depth tracking so trailing
 * commentary (which may contain { or }) doesn't corrupt the slice.
 */
export function extractJsonObject(text: string): string {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  const start = stripped.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in agent output')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1) }
  }
  throw new Error('Unmatched braces in agent JSON output')
}
