import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Use standard postgres driver for local dev
// Switch to @neondatabase/serverless for production Lambda
const client = postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 1 : 10,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
