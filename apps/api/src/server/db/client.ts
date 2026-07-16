import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Apply per-session timeouts to every new connection so stuck queries
// fail fast instead of hanging the test suite. In test mode we use
// aggressive timeouts; in production we leave defaults.
if (process.env.NODE_ENV === 'test') {
  pool.on('connect', (client) => {
    client.query("SET statement_timeout = '5s'");
    client.query("SET lock_timeout = '2s'");
    client.query("SET idle_in_transaction_session_timeout = '5s'");
  });
}

export const db = drizzle(pool, { schema });
export { schema };
export type DrizzleDB = typeof db;

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export async function closeDb(): Promise<void> {
  await pool.end();
}
