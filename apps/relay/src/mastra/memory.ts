import { PostgresStore } from '@mastra/pg'
import pg from 'pg'

// Separate pg.Pool for Mastra
// Does NOT use our Drizzle connection
// All 33 Mastra tables land in 'mastra' schema
// Zero collision with application tables

let store: PostgresStore | null = null

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
