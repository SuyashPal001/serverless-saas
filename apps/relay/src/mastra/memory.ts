import { PostgresStore } from '@mastra/pg'
import { Memory } from '@mastra/memory'
import pg from 'pg'
import { saarthiModel } from './model.js'

// Separate pg.Pool for Mastra
// Does NOT use our Drizzle connection
// All 33 Mastra tables land in 'mastra' schema
// Zero collision with application tables

let store: PostgresStore | null = null
let memory: Memory | null = null

export function getMastraStore(): PostgresStore {
  if (store) return store

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5, // small pool — Mastra only
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  store = new PostgresStore({
    id: 'mastra-pg-store',
    pool,
    schemaName: 'mastra',
  })

  return store
}

// Singleton Memory instance — shared across all tenants.
// Isolation is enforced per-request via resourceId (MASTRA_RESOURCE_ID_KEY)
// set on the RequestContext before each generate() call.
// Created once at startup; never recreated per request.
export function getMastraMemory(): Memory {
  if (memory) return memory

  memory = new Memory({
    storage: getMastraStore(),
    options: {
      lastMessages: 10,
      semanticRecall: false, // no vector store — disable semantic recall
      workingMemory: { enabled: false },
      // observationalMemory disabled pending latency investigation
    },
  })

  return memory
}
