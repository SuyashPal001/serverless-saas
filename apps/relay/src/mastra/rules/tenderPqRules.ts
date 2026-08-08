import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export type PqRuleInput = Record<string, number>

export interface PqRuleResult {
  ruleId: string
  ruleName: string
  status: 'qualified' | 'not_qualified' | 'cannot_evaluate'
  provision: string
  inputs: string[]
  declaredValue: string | null
  thresholdValue: string | null
  message: string
}

interface RawPqRule {
  id: string; name: string; check: string; error: string; provision: string
  inputs: string[]; thresholdVars?: string[]
}

const RULES_PATH = process.env.TENDER_PQ_RULES_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../ai-service/rules/tender/tender_pq_rules.json')

let cached: RawPqRule[] | null = null
function loadRules(): RawPqRule[] {
  if (!cached) {
    cached = (JSON.parse(readFileSync(RULES_PATH, 'utf8')) as { rules: RawPqRule[] }).rules
  }
  return cached
}

function evalCheck(check: string, vars: PqRuleInput): boolean {
  const m = check.match(/^(.+?)\s*(>=|<=|<|>|==)\s*(.+)$/)
  if (!m) throw new Error('bad check')
  const lhs = evalArith(m[1].trim(), vars)
  const rhs = evalArith(m[3].trim(), vars)
  switch (m[2]) {
    case '>=': return lhs >= rhs
    case '<=': return lhs <= rhs
    case '<':  return lhs < rhs
    case '>':  return lhs > rhs
    case '==': return lhs === rhs
    default:   return false
  }
}

function evalArith(expr: string, vars: PqRuleInput): number {
  const trimmed = expr.trim()
  if (/^[0-9]+\.?[0-9]*$/.test(trimmed)) return parseFloat(trimmed)
  if (trimmed in vars) return vars[trimmed]
  throw new Error(`missing:${trimmed}`)
}

// thresholds: values from the tender's PQ criteria (e.g. {turnover_threshold: 5})
export function evaluatePqRules(input: PqRuleInput, thresholds: Record<string, number> = {}): PqRuleResult[] {
  const ctx: PqRuleInput = { ...thresholds, ...input }

  return loadRules().map((rule) => {
    const missingInput = rule.inputs.some(k => !(k in ctx) || typeof ctx[k] !== 'number')
    if (missingInput) {
      return {
        ruleId: rule.id, ruleName: rule.name, status: 'cannot_evaluate', provision: rule.provision,
        inputs: rule.inputs, declaredValue: null, thresholdValue: null,
        message: `Missing required field(s): ${rule.inputs.filter(k => !(k in ctx)).join(', ')}.`,
      }
    }

    let passed: boolean
    try { passed = evalCheck(rule.check, ctx) }
    catch (e) {
      return {
        ruleId: rule.id, ruleName: rule.name, status: 'cannot_evaluate', provision: rule.provision,
        inputs: rule.inputs, declaredValue: null, thresholdValue: null,
        message: `Evaluation error: ${(e as Error).message}`,
      }
    }

    // Surface declared value and threshold from context (not hardcoded)
    const firstInput = rule.inputs[0]
    const firstThreshVar = rule.thresholdVars?.[0]
    const declaredValue = firstInput && ctx[firstInput] != null ? `₹${ctx[firstInput]} Cr` : null
    const thresholdValue = firstThreshVar && ctx[firstThreshVar] != null ? `₹${ctx[firstThreshVar]} Cr` : null

    return {
      ruleId: rule.id, ruleName: rule.name,
      status: passed ? 'qualified' : 'not_qualified',
      provision: rule.provision, inputs: rule.inputs,
      declaredValue, thresholdValue,
      message: passed ? `${rule.name}: qualified.`
        : rule.error.replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? '')),
    }
  })
}
