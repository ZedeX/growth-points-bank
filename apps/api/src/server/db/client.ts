import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

// Build pool options. In test mode, set aggressive timeouts via PostgreSQL
// session options (passed at connection time, not via a separate query).
// Using pool.on('connect') with client.query() caused a race condition:
// the SET query ran concurrently with the first application query on the
// same connection, triggering "client is already executing a query" errors
// and hanging the connection.
const isTest = process.env.NODE_ENV === 'test';
const poolOptions: ConstructorParameters<typeof Pool>[0] = {
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

if (isTest) {
  // These are sent as startup parameters to PostgreSQL, so they apply
  // immediately when the connection is established - no extra query needed.
  poolOptions.options = '-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000';
}

const pool = new Pool(poolOptions);

export const db = drizzle(pool, { schema });
export { schema };
export type DrizzleDB = typeof db;

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export async function closeDb(): Promise<void> {
  await pool.end();
}
