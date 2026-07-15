import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
export { schema };
export type DrizzleDB = typeof db;

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export async function closeDb(): Promise<void> {
  await pool.end();
}
