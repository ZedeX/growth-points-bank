import { db } from './client.js';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';

// Exported so test globalSetup can call it without spawning a subprocess.
// When run as a script (`pnpm db:migrate`), the bottom of the file invokes
// migrate() and exits the process explicitly.
export async function migrate(): Promise<void> {
  console.log('[migrate] Running migrations...');

  // Create tables (idempotent)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS parents (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      email TEXT,
      phone TEXT,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_email ON parents(email) WHERE email IS NOT NULL`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone) WHERE phone IS NOT NULL`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT,
      avatar TEXT,
      age_group TEXT NOT NULL,
      access_token TEXT,
      token_expires_at TEXT,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_children_age_group CHECK (age_group IN ('6-8', '9-11', '12-14'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_children_access_token ON children(access_token) WHERE access_token IS NOT NULL`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_children_family ON children(family_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS growth_dimensions (
      id TEXT PRIMARY KEY,
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_dimensions_family_code ON growth_dimensions(family_id, code)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      dimension_id TEXT NOT NULL REFERENCES growth_dimensions(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT,
      point_value INTEGER NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'easy',
      difficulty_multiplier INTEGER NOT NULL DEFAULT 100,
      frequency TEXT NOT NULL DEFAULT 'daily',
      age_group TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_tasks_difficulty CHECK (difficulty IN ('easy', 'medium', 'hard')),
      CONSTRAINT check_tasks_frequency CHECK (frequency IN ('daily', 'weekly')),
      CONSTRAINT check_tasks_age_group CHECK (age_group IN ('6-8', '9-11', '12-14')),
      CONSTRAINT check_tasks_point_value CHECK (point_value BETWEEN 1 AND 100)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_family ON tasks(family_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_dimension ON tasks(dimension_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      note TEXT,
      revoked_by_parent INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_child_task_date ON checkins(child_id, task_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_checkins_child_date ON checkins(child_id, date)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS point_transactions (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_point_tx_amount CHECK (amount <> 0),
      CONSTRAINT check_point_tx_source_type CHECK (source_type IN ('task', 'reward', 'revocation'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_point_tx_child_created ON point_transactions(child_id, created_at DESC)`);
  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_point_tx_source
    ON point_transactions(child_id, source_type, source_id)
    WHERE source_type IN ('task', 'reward', 'revocation')
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      point_cost INTEGER NOT NULL,
      total_inventory INTEGER NOT NULL DEFAULT 999,
      total_claimed INTEGER NOT NULL DEFAULT 0,
      weekly_limit_per_child INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_rewards_point_cost CHECK (point_cost BETWEEN 1 AND 10000),
      CONSTRAINT check_rewards_inventory CHECK (total_claimed <= total_inventory)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_rewards_family ON rewards(family_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS reward_redemptions (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      reward_id TEXT NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
      point_cost INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parent_note TEXT,
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      fulfilled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_redemption_status CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_child ON reward_redemptions(child_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_reward ON reward_redemptions(reward_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_status ON reward_redemptions(status)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS weekly_reviews (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      week_start_date TEXT NOT NULL,
      best_thing TEXT,
      difficulty TEXT,
      child_request TEXT,
      child_committed_at TEXT,
      parent_observation TEXT,
      parent_committed_at TEXT,
      task_count INTEGER,
      point_earned INTEGER,
      dimension_count INTEGER,
      locked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_review_commit_state CHECK (
        (child_committed_at IS NULL AND parent_committed_at IS NULL)
        OR (child_committed_at IS NOT NULL AND parent_committed_at IS NULL AND locked_at IS NULL)
        OR (child_committed_at IS NULL AND parent_committed_at IS NOT NULL AND locked_at IS NULL)
        OR (child_committed_at IS NOT NULL AND parent_committed_at IS NOT NULL AND locked_at IS NOT NULL)
      )
    )
  `);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reviews_child_week ON weekly_reviews(child_id, week_start_date)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS weekly_review_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL REFERENCES weekly_reviews(id) ON DELETE CASCADE,
      reader_role TEXT NOT NULL,
      field_read TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_access_log_reader CHECK (reader_role IN ('child', 'parent', 'system'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS growth_diaries (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      title TEXT,
      content TEXT,
      category TEXT NOT NULL DEFAULT 'reflection',
      week_start_date TEXT,
      created_by_child INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_diary_category CHECK (category IN ('achievement', 'reflection', 'goal', 'memory'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_diaries_child ON growth_diaries(child_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_diaries_created ON growth_diaries(child_id, created_at DESC)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      child_id TEXT REFERENCES children(id) ON DELETE CASCADE,
      recipient_role TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_notif_recipient CHECK (recipient_role IN ('parent', 'child'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_family ON notifications(family_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(family_id, is_read)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      actor_role TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT check_audit_actor CHECK (actor_role IN ('parent', 'child', 'system'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_family ON audit_logs(family_id, created_at DESC)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS conflict_alerts (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      child_id TEXT REFERENCES children(id) ON DELETE CASCADE,
      resolved_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_conflict_family ON conflict_alerts(family_id, resolved_at)`);

  console.log('[migrate] All migrations applied successfully.');
}

// Only run as a script (e.g. `pnpm db:migrate` / `tsx src/server/db/migrate.ts`).
// When imported (e.g. by vitest globalSetup), the importer is responsible for
// calling migrate() and managing the process lifecycle.
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  migrate()
    .then(() => {
      console.log('[migrate] Done. Exiting.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[migrate] Migration failed:', err);
      process.exit(1);
    });
}
