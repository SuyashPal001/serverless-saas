/**
 * Seed script: Government Tender Evaluation Demo
 * Tender: HRMS procurement — MP-DIT/HRMS/2024-25/001, Dept of IT, Govt of Madhya Pradesh
 *
 * Bidders:
 *   A — InfraVision Technologies (PASSES PQ, has tech deviations → clarification)
 *   B — TechAxis Solutions (FAILS PQ — turnover below threshold)
 *   C — NovaSys Integrators (PASSES PQ, minor tech deviation, L2 on financial)
 *
 * L1 = InfraVision (Bidder A) at ₹7.82 Cr
 *
 * Run: npx tsx scripts/seed_tender_demo.ts
 * Requires: DATABASE_URL env var pointing to the local Postgres instance
 *           SEED_TENANT_ID env var (your demo tenant UUID)
 */

import 'dotenv/config'
import { Pool } from 'pg'

const TENANT_ID = process.env.SEED_TENDER_TENANT_ID ?? process.env.SEED_TENANT_ID
if (!TENANT_ID) { console.error('SEED_TENANT_ID required'); process.exit(1) }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = { query: (text: string, values?: unknown[]) => pool.query(text, values) }

async function upsert(table: string, data: Record<string, unknown>, conflictCols: string[] = ['id']): Promise<string> {
  const keys = Object.keys(data)
  const vals = Object.values(data)
  const placeholders = keys.map((_, i) => `$${i + 1}`)
  const updateSet = keys.filter(k => !conflictCols.includes(k)).map(k => `${k} = EXCLUDED.${k}`)
  const q = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ${updateSet.join(', ')}
    RETURNING id
  `
  const result = await db.query(q, vals)
  return result.rows[0].id as string
}

async function seed() {
  console.log('Seeding tender demo for tenant:', TENANT_ID)

  // ── Tender ──────────────────────────────────────────────────────────────────
  const tenderId = await upsert('tenders', {
    id: 'a0000000-0000-0000-0000-000000000001',
    tenant_id: TENANT_ID,
    rfp_number: 'MP-DIT/HRMS/2024-25/001',
    title: 'Supply & Implementation of Human Resource Management System (HRMS) for State Departments, Madhya Pradesh',
    department: 'Department of Information Technology, Govt. of Madhya Pradesh',
    budget: '85000000',
    eval_method: 'L1',
    status: 'evaluation',
    pq_criteria: JSON.stringify({
      turnover: { threshold: 5, unit: 'crore', years: 3 },
      similarWork: { threshold: 2, unit: 'crore', minProjects: 1 },
      oemAuth: true, noBlacklisting: true,
    }),
    version: 2,
    published_at: '2024-11-01T10:00:00Z',
  }, ['id'])
  console.log('  ✓ tender:', tenderId)

  // ── Stage 1 — Clause library snapshot (illustrative) ────────────────────────
  const clauses = [
    { no: '3.2', title: 'Core HRMS Modules', content: 'Payroll, Leave, and Attendance modules as integrated suite with SSO.', category: 'technical' },
    { no: '3.8', title: 'System Uptime SLA', content: 'Minimum 99.5% uptime with downtime reporting within 1 hour.', category: 'sla' },
    { no: '5.1', title: 'Biometric Integration', content: 'Integration via standard protocol (HL7/FHIR). Proprietary interfaces not acceptable.', category: 'technical' },
  ]
  for (const cl of clauses) {
    await db.query(`
      INSERT INTO tender_clauses (tenant_id, tender_id, clause_no, title, content, category, version)
      VALUES ($1,$2,$3,$4,$5,$6,2) ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, cl.no, cl.title, cl.content, cl.category])
  }
  console.log('  ✓ clauses (stage 1)')

  // ── Stage 2 — Corrigendum + pre-bid queries ──────────────────────────────────
  await db.query(`
    INSERT INTO corrigenda (tenant_id, tender_id, corrigendum_no, changes_summary, changed_clauses, issued_at)
    VALUES ($1,$2,'Corrigendum No. 1',
      'Extended bid submission by 15 days. Clarified Clause 3.9 response time measurement.',
      $3, '2024-11-18T00:00:00Z') ON CONFLICT DO NOTHING`,
    [TENANT_ID, tenderId, JSON.stringify([
      { clauseNo: '1.6', from: 'Bid submission: 03 December 2024', to: 'Bid submission: 18 December 2024' },
      { clauseNo: '3.9', from: 'Response time < 2s for all transactions', to: 'Response time < 2s for 95% of transactions under normal load' },
    ])])
  const queries = [
    { no: 'Q-001', q: 'Can biometric integration be proposed via API rather than direct SDK?', r: 'Yes, API-based integration is acceptable provided it uses a non-proprietary standard protocol.' },
    { no: 'Q-002', q: 'Is cloud hosting acceptable or must servers be on-premises?', r: 'Cloud hosting on MeitY-empanelled CSPs is acceptable. Data must remain within India. MP State Data Centre hosting is preferred.' },
    { no: 'Q-003', q: 'Can training be delivered via e-learning for admin users?', r: 'Classroom training is mandatory for all 200 end-users. E-learning may supplement but cannot replace classroom training.' },
  ]
  for (const q of queries) {
    await db.query(`
      INSERT INTO prebid_queries (tenant_id, tender_id, query_no, query_text, drafted_response, final_response, status)
      VALUES ($1,$2,$3,$4,$5,$5,'responded') ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, q.no, q.q, q.r])
  }
  console.log('  ✓ corrigendum + pre-bid queries (stage 2)')

  // ── Bidders ──────────────────────────────────────────────────────────────────
  const bidderDefs = [
    {
      id: 'b0000000-0000-0000-0000-000000000101', name: 'InfraVision Technologies Pvt. Ltd.',
      label: 'Bidder A', status: 'pq_qualified',
      pqFields: { avg_turnover_crore: 6.8, max_similar_work_crore: 3.2, has_oem_auth: 1, is_blacklisted: 0 },
    },
    {
      id: 'b0000000-0000-0000-0000-000000000102', name: 'TechAxis Solutions Ltd.',
      label: 'Bidder B', status: 'pq_disqualified',
      pqFields: { avg_turnover_crore: 3.2, max_similar_work_crore: 2.4, has_oem_auth: 1, is_blacklisted: 0 },
    },
    {
      id: 'b0000000-0000-0000-0000-000000000103', name: 'NovaSys Integrators Pvt. Ltd.',
      label: 'Bidder C', status: 'financial_evaluated',
      pqFields: { avg_turnover_crore: 9.1, max_similar_work_crore: 4.5, has_oem_auth: 1, is_blacklisted: 0 },
    },
  ]

  for (const b of bidderDefs) {
    await upsert('bidders', {
      id: b.id, tenant_id: TENANT_ID, tender_id: tenderId,
      name: b.name, display_label: b.label, status: b.status,
      document_ids: JSON.stringify({ pqFields: b.pqFields }),
    }, ['id'])
  }
  console.log('  ✓ bidders')

  // ── PQ findings (stage 3) ────────────────────────────────────────────────────
  const pqData = [
    // Bidder A — passes all
    { bidder: 'b0000000-0000-0000-0000-000000000101', ruleId: 'PQ001', name: 'Annual Turnover Threshold', status: 'qualified', provision: 'GFR 2017 Rule 160', narration: 'InfraVision Technologies reports average annual turnover of ₹6.8 Cr over the last 3 financial years, meeting the minimum threshold of ₹5 Cr.', declared: '₹6.8 Cr', threshold: '₹5 Cr', doc: 'Audited Balance Sheet FY2021-24', page: 3 },
    { bidder: 'b0000000-0000-0000-0000-000000000101', ruleId: 'PQ002', name: 'Similar Work Experience', status: 'qualified', provision: 'GFR 2017 Rule 161', narration: 'Bidder has executed HRMS implementation for MPSEDC valued at ₹3.2 Cr, exceeding the minimum similar work threshold of ₹2 Cr.', declared: '₹3.2 Cr', threshold: '₹2 Cr', doc: 'Work Order MPSEDC/IT/2022/047', page: 1 },
    { bidder: 'b0000000-0000-0000-0000-000000000101', ruleId: 'PQ003', name: 'OEM Authorization', status: 'qualified', provision: 'RFP Clause 2.4', narration: 'Valid OEM authorization letter from SAP India Pvt. Ltd. submitted, effective until March 2026.', declared: null, threshold: null, doc: 'OEM Authorization Letter', page: 1 },
    { bidder: 'b0000000-0000-0000-0000-000000000101', ruleId: 'PQ004', name: 'No Blacklisting', status: 'qualified', provision: 'GFR 2017 Rule 175', narration: 'Self-declaration submitted. No blacklisting orders found against InfraVision Technologies.', declared: null, threshold: null, doc: 'Self-Declaration Affidavit', page: 1 },
    // Bidder B — FAILS turnover
    { bidder: 'b0000000-0000-0000-0000-000000000102', ruleId: 'PQ001', name: 'Annual Turnover Threshold', status: 'not_qualified', provision: 'GFR 2017 Rule 160', narration: 'TechAxis Solutions declared average annual turnover of ₹3.2 Cr for FY2021-24, which is below the mandatory minimum of ₹5 Cr as per GFR 2017 Rule 160.', declared: '₹3.2 Cr', threshold: '₹5 Cr', doc: 'Audited Balance Sheet FY2021-24', page: 4 },
    { bidder: 'b0000000-0000-0000-0000-000000000102', ruleId: 'PQ002', name: 'Similar Work Experience', status: 'qualified', provision: 'GFR 2017 Rule 161', narration: 'Similar work experience of ₹2.4 Cr meets the threshold.', declared: '₹2.4 Cr', threshold: '₹2 Cr', doc: 'Work Order Evidence', page: 2 },
    { bidder: 'b0000000-0000-0000-0000-000000000102', ruleId: 'PQ003', name: 'OEM Authorization', status: 'qualified', provision: 'RFP Clause 2.4', narration: 'OEM authorization submitted and valid.', declared: null, threshold: null, doc: 'OEM Letter', page: 1 },
    { bidder: 'b0000000-0000-0000-0000-000000000102', ruleId: 'PQ004', name: 'No Blacklisting', status: 'qualified', provision: 'GFR 2017 Rule 175', narration: 'No blacklisting. Self-declaration submitted.', declared: null, threshold: null, doc: 'Affidavit', page: 1 },
    // Bidder C — passes all
    { bidder: 'b0000000-0000-0000-0000-000000000103', ruleId: 'PQ001', name: 'Annual Turnover Threshold', status: 'qualified', provision: 'GFR 2017 Rule 160', narration: 'NovaSys Integrators reports average annual turnover of ₹9.1 Cr, well above the ₹5 Cr threshold.', declared: '₹9.1 Cr', threshold: '₹5 Cr', doc: 'Audited Balance Sheet FY2021-24', page: 5 },
    { bidder: 'b0000000-0000-0000-0000-000000000103', ruleId: 'PQ002', name: 'Similar Work Experience', status: 'qualified', provision: 'GFR 2017 Rule 161', narration: 'NovaSys executed ERP for NHM valued at ₹4.5 Cr — exceeds threshold.', declared: '₹4.5 Cr', threshold: '₹2 Cr', doc: 'Work Order NHM/2021/105', page: 2 },
    { bidder: 'b0000000-0000-0000-0000-000000000103', ruleId: 'PQ003', name: 'OEM Authorization', status: 'qualified', provision: 'RFP Clause 2.4', narration: 'OEM authorization from Oracle India valid through 2026.', declared: null, threshold: null, doc: 'OEM Auth Letter', page: 1 },
    { bidder: 'b0000000-0000-0000-0000-000000000103', ruleId: 'PQ004', name: 'No Blacklisting', status: 'qualified', provision: 'GFR 2017 Rule 175', narration: 'No blacklisting. Self-declaration submitted.', declared: null, threshold: null, doc: 'Affidavit', page: 1 },
  ]
  for (const p of pqData) {
    await db.query(`
      INSERT INTO pq_findings (tenant_id, tender_id, bidder_id, rule_id, rule_name, status, provision, narration, declared_value, threshold_value, source_doc, source_page)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, p.bidder, p.ruleId, p.name, p.status, p.provision, p.narration, p.declared, p.threshold, p.doc, p.page])
  }
  console.log('  ✓ PQ findings (stage 3) — Bidder B FAILS turnover')

  // ── Technical findings for qualified bidders (A + C) (stage 4) ──────────────
  const CLAUSES = [
    { no: '3.2', title: 'Core HRMS Modules' }, { no: '3.5', title: 'Integration with Govt Systems' },
    { no: '3.8', title: 'System Uptime SLA' }, { no: '3.9', title: 'Response Time SLA' },
    { no: '3.12', title: 'Training & Capacity Building' }, { no: '3.15', title: 'Data Security & Compliance' },
    { no: '4.3', title: 'Go-live Timeline' }, { no: '5.1', title: 'Biometric Integration Protocol' },
  ]
  const techData: Array<{bidder: string; clauseNo: string; clauseTitle: string; status: string; narration: string; doc: string; page: number}> = []
  // InfraVision (A): deviations on 3.9 and 5.1
  for (const cl of CLAUSES) {
    let status = 'complied', narration = `Bidder complies with ${cl.title} as specified in RFP.`
    if (cl.no === '3.9') { status = 'deviation'; narration = 'InfraVision commits to <3 second response time. RFP requires <2 seconds for 95% of transactions — deviation noted.' }
    if (cl.no === '5.1') { status = 'deviation'; narration = 'Bidder proposes proprietary InfraVis API for biometric integration. RFP requires a non-proprietary standard protocol (HL7/FHIR). Clarification requested.' }
    techData.push({ bidder: 'b0000000-0000-0000-0000-000000000101', clauseNo: cl.no, clauseTitle: cl.title, status, narration, doc: 'Technical Proposal — InfraVision', page: Math.floor(Math.random() * 30) + 5 })
  }
  // NovaSys (C): deviation only on 3.12
  for (const cl of CLAUSES) {
    let status = 'complied', narration = `NovaSys complies with ${cl.title}.`
    if (cl.no === '3.12') { status = 'deviation'; narration = 'NovaSys proposes e-learning portal for admin training. RFP mandates classroom training for all 200 end-users — minor deviation.' }
    techData.push({ bidder: 'b0000000-0000-0000-0000-000000000103', clauseNo: cl.no, clauseTitle: cl.title, status, narration, doc: 'Technical Proposal — NovaSys', page: Math.floor(Math.random() * 30) + 5 })
  }
  for (const t of techData) {
    await db.query(`
      INSERT INTO technical_findings (tenant_id, tender_id, bidder_id, clause_no, clause_title, status, narration, source_doc, source_page, run_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'seeded') ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, t.bidder, t.clauseNo, t.clauseTitle, t.status, t.narration, t.doc, t.page])
  }
  console.log('  ✓ technical findings (stage 4 — seeded; Clause 5.1 deviation in InfraVision)')

  // ── Shortfall + clarification for InfraVision Clause 5.1 (stage 5) ──────────
  const sfResult = await db.query(`
    INSERT INTO shortfalls (tenant_id, tender_id, bidder_id, discrepancy, source_doc, source_page, status)
    VALUES ($1,$2,'b0000000-0000-0000-0000-000000000101',
      'Clause 5.1 — Biometric Integration Protocol: Bidder proposes proprietary InfraVis API. RFP requires non-proprietary standard protocol (HL7/FHIR). Nature of integration interface is ambiguous.',
      'Technical Proposal — InfraVision', 18, 'open')
    ON CONFLICT DO NOTHING RETURNING id`,
    [TENANT_ID, tenderId])

  if (sfResult.rows[0]) {
    await db.query(`
      INSERT INTO clarification_requests (tenant_id, tender_id, shortfall_id, bidder_id, drafted_text, deadline_days)
      VALUES ($1,$2,$3,'b0000000-0000-0000-0000-000000000101',
        'With reference to your technical bid submitted against RFP No. MP-DIT/HRMS/2024-25/001, it is observed that Clause 5.1 requires biometric integration using a non-proprietary standard protocol. Your proposal mentions the "InfraVis Biometric API" without specifying the underlying protocol. You are requested to clarify whether the proposed integration uses HL7/FHIR or another standard non-proprietary protocol as mandated. Response required within 7 working days. No change in quoted price or technical specifications shall be permitted.',
        7) ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, sfResult.rows[0].id])
  }
  console.log('  ✓ shortfall + CVC-clean clarification (stage 5)')

  // ── Financial findings for A + C (stage 6) ───────────────────────────────────
  const finData = [
    {
      bidder: 'b0000000-0000-0000-0000-000000000101',
      boq: [
        { item: 'HRMS Software License (Enterprise)', rfpQty: 1, unit: 'Lot', quotedRate: 28000000, amount: 28000000 },
        { item: 'Implementation & Customization', rfpQty: 1, unit: 'Lot', quotedRate: 25000000, amount: 25000000 },
        { item: 'Training (Classroom + Admin)', rfpQty: 1, unit: 'Lot', quotedRate: 7500000, amount: 7500000 },
        { item: 'Annual Maintenance Contract (3 yr)', rfpQty: 3, unit: 'Year', quotedRate: 5900000, amount: 17700000 },
      ],
      total: 78200000, correction: 0, isL1: 'yes', margin: null, doc: 'Financial Bid — BOQ Schedule', page: 2,
    },
    {
      bidder: 'b0000000-0000-0000-0000-000000000103',
      boq: [
        { item: 'HRMS Software License (Enterprise)', rfpQty: 1, unit: 'Lot', quotedRate: 32000000, amount: 32000000 },
        { item: 'Implementation & Customization', rfpQty: 1, unit: 'Lot', quotedRate: 28500000, amount: 28500000 },
        { item: 'Training (Classroom + Admin)', rfpQty: 1, unit: 'Lot', quotedRate: 6000000, amount: 6000000 },
        { item: 'Annual Maintenance Contract (3 yr)', rfpQty: 3, unit: 'Year', quotedRate: 5000000, amount: 15000000 },
      ],
      total: 81500000, correction: 0, isL1: 'no', margin: 3300000, doc: 'Financial Bid — Price Schedule', page: 3,
    },
  ]
  for (const f of finData) {
    await db.query(`
      INSERT INTO financial_findings (tenant_id, tender_id, bidder_id, boq_lines, total_amount, arithmetic_correction, corrected_total, is_l1, l1_margin, source_doc, source_page)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [TENANT_ID, tenderId, f.bidder, JSON.stringify(f.boq), String(f.total), '0', String(f.total + f.correction), f.isL1, f.margin != null ? String(f.margin) : null, f.doc, f.page])
  }
  console.log('  ✓ financial findings (stage 6) — InfraVision L1 at ₹7.82 Cr')

  // ── Evaluation report ────────────────────────────────────────────────────────
  await db.query(`
    INSERT INTO evaluation_reports (tenant_id, tender_id, pq_summary, tech_summary, fin_summary, recommendation, l1_bidder_id)
    VALUES ($1,$2,$3,$4,$5,$6,'b0000000-0000-0000-0000-000000000101') ON CONFLICT DO NOTHING`,
    [TENANT_ID, tenderId,
      JSON.stringify({ total: 3, qualified: 2, disqualified: 1 }),
      JSON.stringify({ evaluated: 2, deviations: { 'Bidder A': 2, 'Bidder C': 1 } }),
      JSON.stringify({ l1: 'InfraVision Technologies', l1Amount: 78200000 }),
      'Based on PQ scrutiny (2 of 3 qualified), technical evaluation (clause-wise compliance assessed), and financial bid comparison, InfraVision Technologies Pvt. Ltd. (Bidder A) is determined as L1 with a corrected total bid value of ₹7.82 Cr for RFP MP-DIT/HRMS/2024-25/001. Recommend award of contract subject to officer approval and resolution of Clause 5.1 clarification, in compliance with GFR 2017 Rule 166.',
    ])
  console.log('  ✓ evaluation report')
  console.log('\n✅ Seed complete. Open /[tenant]/dashboard/tender-evaluation to view the cockpit.')
  await pool.end()
}

seed().catch(e => { console.error(e); process.exit(1) })
