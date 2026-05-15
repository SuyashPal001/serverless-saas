import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

function createDb() {
  if (connectionString.includes('neon.tech')) {
    // Production — Neon HTTP driver (no TCP connection pooling problem)
    const { neon } = require('@neondatabase/serverless');
    const { drizzle } = require('drizzle-orm/neon-http');
    const sql = neon(connectionString);
    return drizzle(sql, { schema });
  } else {
    // Local dev — standard postgres TCP driver
    const postgres = require('postgres');
    const { drizzle } = require('drizzle-orm/postgres-js');
    const client = postgres(connectionString, { max: 10 });
    return drizzle(client, { schema });
  }
}

export const db = createDb();
console.log('[db] schema keys registered:', Object.keys((db as any)._.schema || {}));
console.log('[db] query keys:', Object.keys((db as any).query || {}));
export type DB = typeof db;