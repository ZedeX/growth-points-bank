import { db, schema } from './client.js';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('[migrate] Running migrations...');

  // Create schema if not exists
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS app`);

  // Create tables (idempotent)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.families (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.parents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      email TEXT,
      phone TEXT,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_email ON app.parents(email) WHERE email IS NOT NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_phone ON app.parents(phone) WHERE phone IS NOT NULL
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.children (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      name TEXT,
      avatar TEXT,
      age_group TEXT NOT NULL,
      access_token TEXT,
      token_expires_at TIMESTAMPTZ,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_children_age_group CHECK (age_group IN ('6-8', '9-11', '12-14'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_children_access_token ON app.children(access_token) WHERE access_token IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_children_family ON app.children(family_id)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.growth_dimensions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID REFERENCES app.families(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_dimensions_family_code ON app.growth_dimensions(family_id, code)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      dimension_id UUID NOT NULL REFERENCES app.growth_dimensions(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT,
      point_value INTEGER NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'easy',
      difficulty_multiplier INTEGER NOT NULL DEFAULT 100,
      frequency TEXT NOT NULL DEFAULT 'daily',
      age_group TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_tasks_difficulty CHECK (difficulty IN ('easy', 'medium', 'hard')),
      CONSTRAINT check_tasks_frequency CHECK (frequency IN ('daily', 'weekly')),
      CONSTRAINT check_tasks_age_group CHECK (age_group IN ('6-8', '9-11', '12-14')),
      CONSTRAINT check_tasks_point_value CHECK (point_value BETWEEN 1 AND 100)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tasks_family ON app.tasks(family_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tasks_dimension ON app.tasks(dimension_id)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.checkins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      child_id UUID NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      note TEXT,
      revoked_by_parent BOOLEAN NOT NULL DEFAULT false,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_child_task_date ON app.checkins(child_id, task_id, date)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_checkins_child_date ON app.checkins(child_id, date)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.point_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      child_id UUID NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id UUID NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_point_tx_amount CHECK (amount <> 0),
      CONSTRAINT check_point_tx_source_type CHECK (source_type IN ('task', 'reward', 'revocation'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_point_tx_child_created ON app.point_transactions(child_id, created_at DESC)`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_point_tx_source
    ON app.point_transactions(child_id, source_type, source_id)
    WHERE source_type IN ('task', 'reward', 'revocation')
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.rewards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      point_cost INTEGER NOT NULL,
      total_inventory INTEGER NOT NULL DEFAULT 999,
      total_claimed INTEGER NOT NULL DEFAULT 0,
      weekly_limit_per_child INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_rewards_point_cost CHECK (point_cost BETWEEN 1 AND 10000),
      CONSTRAINT check_rewards_inventory CHECK (total_claimed <= total_inventory)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rewards_family ON app.rewards(family_id)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.reward_redemptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      child_id UUID NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
      reward_id UUID NOT NULL REFERENCES app.rewards(id) ON DELETE CASCADE,
      point_cost INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parent_note TEXT,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ,
      fulfilled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_redemption_status CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_child ON app.reward_redemptions(child_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_reward ON app.reward_redemptions(reward_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_redemptions_status ON app.reward_redemptions(status)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.weekly_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      child_id UUID NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
      week_start_date DATE NOT NULL,
      best_thing TEXT,
      difficulty TEXT,
      child_request TEXT,
      child_committed_at TIMESTAMPTZ,
      parent_observation TEXT,
      parent_committed_at TIMESTAMPTZ,
      task_count INTEGER,
      point_earned INTEGER,
      dimension_count INTEGER,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_review_commit_state CHECK (
        (child_committed_at IS NULL AND parent_committed_at IS NULL)
        OR (child_committed_at IS NOT NULL AND parent_committed_at IS NULL AND locked_at IS NULL)
        OR (child_committed_at IS NULL AND parent_committed_at IS NOT NULL AND locked_at IS NULL)
        OR (child_committed_at IS NOT NULL AND parent_committed_at IS NOT NULL AND locked_at IS NOT NULL)
      )
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reviews_child_week ON app.weekly_reviews(child_id, week_start_date)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.weekly_review_access_log (
      id BIGSERIAL PRIMARY KEY,
      review_id UUID NOT NULL REFERENCES app.weekly_reviews(id) ON DELETE CASCADE,
      reader_role TEXT NOT NULL,
      field_read TEXT NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_access_log_reader CHECK (reader_role IN ('child', 'parent', 'system'))
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.growth_diaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      child_id UUID NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
      title TEXT,
      content TEXT,
      category TEXT NOT NULL DEFAULT 'reflection',
      week_start_date DATE,
      created_by_child BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_diary_category CHECK (category IN ('achievement', 'reflection', 'goal', 'memory'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_diaries_child ON app.growth_diaries(child_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_diaries_created ON app.growth_diaries(child_id, created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      child_id UUID REFERENCES app.children(id) ON DELETE CASCADE,
      recipient_role TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      is_read BOOLEAN NOT NULL DEFAULT false,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_notif_recipient CHECK (recipient_role IN ('parent', 'child'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_notif_family ON app.notifications(family_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_notif_unread ON app.notifications(family_id, is_read)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.audit_logs (
      id BIGSERIAL PRIMARY KEY,
      family_id UUID REFERENCES app.families(id) ON DELETE CASCADE,
      actor_role TEXT NOT NULL,
      actor_id UUID,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id UUID,
      metadata JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT check_audit_actor CHECK (actor_role IN ('parent', 'child', 'system'))
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_family ON app.audit_logs(family_id, created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.conflict_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      child_id UUID REFERENCES app.children(id) ON DELETE CASCADE,
      resolved_at TIMESTAMPTZ,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conflict_family ON app.conflict_alerts(family_id, resolved_at)`);

  console.log('[migrate] All migrations applied successfully.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
