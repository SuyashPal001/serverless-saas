/**
 * Seed tender agents for MP-DIT tenant (c153e72f-c000-4a1e-a2b3-269d8437aa24).
 * Idempotent — skips if any of the four agents already exist by name.
 * Run: npx tsx seeds/tender-agents.ts
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and, inArray } from 'drizzle-orm'
import * as schema from '../schema/index'

const TENANT_ID = 'c153e72f-c000-4a1e-a2b3-269d8437aa24'
const OFFICER_ID = 'fb06615a-2c6a-4573-9237-b932485b9a44'
const API_KEY_ID = 'a5b6b6b6-ceb8-4a3a-8324-5be6eb3b3de1'
const WEB_SEARCH_TOOL_ID = '3cf81950-d9b6-4baf-a8aa-67ee254019ca'

const AGENTS = [
  {
    name: 'RFP Authoring Agent',
    description: 'Drafts complete government RFPs from a requirement document and template fields. Structures all 8 GFR-2017 sections — NIT, eligibility, scope, technical specs, SLA/KPI, BOQ, evaluation methodology, and contract terms. Draws clauses from your organisation\'s clause library and flags CVC-safety issues before export. Every section is versioned and requires officer acceptance before the document is finalised.',
    avatarUrl: null,
  },
  {
    name: 'Document Intelligence Agent',
    description: 'Extracts structured data from uploaded bid documents — PDFs, Word files, and scanned images — with page-level provenance for every value it reports. Parses eligibility declarations, BOQ line items, financial statements, and experience certificates. Never fabricates or infers beyond what is present in the document; each finding cites its exact source page.',
    avatarUrl: null,
  },
  {
    name: 'Bid Evaluation Agent',
    description: 'Evaluates submitted bids clause-by-clause against the RFP — marking each criterion as complied, deviation, or not-found — with a cited narration for every finding. Compares results across all bidders and surfaces shortfalls for clarification. The officer owns the final verdict; this agent only prepares the evidence and routes findings to the review queue.',
    avatarUrl: null,
  },
  {
    name: 'Procurement Advisor',
    description: 'Answers procurement questions grounded in your own tender documents and RAG-retrieved precedents — every answer carries source citations. Provides trade-off analysis across evaluation dimensions and flags risks in bid or RFP design. Does not recommend a specific bidder; all advisory output is audit-clean and source-attributed for file noting.',
    avatarUrl: null,
  },
]

async function run() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  const db = drizzle(client, { schema })

  const existing = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.tenantId, TENANT_ID),
        inArray(schema.agents.name, AGENTS.map(a => a.name))
      )
    )

  const existingNames = new Set(existing.map(r => r.name))
  const toInsert = AGENTS.filter(a => !existingNames.has(a.name))

  if (!toInsert.length) {
    console.log('All 4 tender agents already seeded — skipping')
    await client.end()
    return
  }

  const inserted = await db.insert(schema.agents).values(
    toInsert.map(a => ({
      tenantId: TENANT_ID,
      name: a.name,
      type: 'custom' as const,
      status: 'active' as const,
      model: 'saarthi-sovereign',
      apiKeyId: API_KEY_ID,
      avatarUrl: a.avatarUrl,
      description: a.description,
      isInternal: false,
      createdBy: OFFICER_ID,
    }))
  ).returning({ id: schema.agents.id, name: schema.agents.name })

  console.log(`Inserted ${inserted.length} agents:`, inserted.map(a => a.name))

  // Assign web_search tool to each new agent
  if (inserted.length) {
    await db.insert(schema.agentToolAssignments).values(
      inserted.map(a => ({
        agentId: a.id,
        toolId: WEB_SEARCH_TOOL_ID,
        tenantId: TENANT_ID,
        createdBy: OFFICER_ID,
      }))
    )
    console.log('Tool assignments created')
  }

  await client.end()
  console.log('Done')
}

run().catch(async err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
