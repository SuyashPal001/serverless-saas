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
  id: string; name: string; check: string; error: string; provision: string; inputs: string[]
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

export function evaluatePqRules(input: PqRuleInput): PqRuleResult[] {
  return loadRules().map((rule) => {
    const missing = rule.inputs.some(k => !(k in input) || typeof input[k] !== 'number')
    if (missing) {
      return {
        ruleId: rule.id, ruleName: rule.name, status: 'cannot_evaluate', provision: rule.provision,
        inputs: rule.inputs, declaredValue: null, thresholdValue: null, message: 'Missing required input.',
      }
    }

    let passed: boolean
    try { passed = evalCheck(rule.check, input) }
    catch {
      return {
        ruleId: rule.id, ruleName: rule.name, status: 'cannot_evaluate', provision: rule.provision,
        inputs: rule.inputs, declaredValue: null, thresholdValue: null, message: 'Could not evaluate.',
      }
    }

    // Surface declared vs threshold for financial rules
    let declaredValue: string | null = null
    let thresholdValue: string | null = null
    if (rule.id === 'PQ001') {
      declaredValue = `₹${input.avg_turnover_crore} Cr`
      thresholdValue = '₹5 Cr'
    }
    if (rule.id === 'PQ002') {
      declaredValue = `₹${input.max_similar_work_crore} Cr`
      thresholdValue = '₹2 Cr'
    }

    return {
      ruleId: rule.id, ruleName: rule.name,
      status: passed ? 'qualified' : 'not_qualified',
      provision: rule.provision, inputs: rule.inputs,
      declaredValue, thresholdValue,
      message: passed ? `${rule.name}: qualified.` : rule.error
        .replace(/\{(\w+)\}/g, (_, k) => String(input[k] ?? '')),
    }
  })
}
