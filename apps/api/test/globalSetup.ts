// Global setup: runs once before all test files.
// Runs database migrations to ensure tables exist.

import { migrate } from '../src/server/db/migrate.js';

export async function setup(): Promise<void> {
  // Set test env defaults if not already set
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for integration tests');
  }
  if (!process.env.PARENT_JWT_SECRET) process.env.PARENT_JWT_SECRET = 'test-parent-secret-32-chars-minimum-length';
  if (!process.env.CHILD_JWT_SECRET) process.env.CHILD_JWT_SECRET = 'test-child-secret-32-chars-minimum-length';
  if (!process.env.AUTH_HMAC_SECRET) process.env.AUTH_HMAC_SECRET = 'test-hmac-secret-32-chars-minimum';
  if (!process.env.DATA_ENCRYPTION_KEY) process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

  // Run migrations
  try {
    await migrate();
    console.log('[globalSetup] Migrations applied successfully');
  } catch (err) {
    console.error('[globalSetup] Migration failed:', err);
    throw err;
  }

  // Note: Per-session statement_timeout / lock_timeout / idle_in_transaction_session_timeout
  // are set in db/client.ts via pool.on('connect') so they apply to ALL connections.
}

export async function teardown(): Promise<void> {
  // Close db connection
  const { closeDb } = await import('../src/server/db/client.js');
  await closeDb();
}
