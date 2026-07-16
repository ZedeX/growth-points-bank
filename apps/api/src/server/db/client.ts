import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';

const dbPath = process.env.DATABASE_URL || 'data/gpb.db';

// Ensure directory exists
import { mkdirSync } from 'fs';
import { dirname } from 'path';
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
export type DrizzleDB = typeof db;

export async function closeDb(): Promise<void> {
  sqlite.close();
}
