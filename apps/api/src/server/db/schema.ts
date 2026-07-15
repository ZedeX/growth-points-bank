import {
  pgTable, uuid, text, integer, boolean, timestamp, date, jsonb,
  primaryKey, uniqueIndex, index, check, pgSchema, serial, bigserial,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Use 'app' schema (Conflict #1 resolution)
export const appSchema = pgSchema('app');

// === families ===
export const families = appSchema.table('families', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// === parents ===
export const parents = appSchema.table('parents', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  email: text('email'),
  phone: text('phone'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUnique: uniqueIndex('idx_parents_email').on(t.email).where(sql`email IS NOT NULL`),
  phoneUnique: uniqueIndex('idx_parents_phone').on(t.phone).where(sql`phone IS NOT NULL`),
}));

// === children ===
export const children = appSchema.table('children', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  name: text('name'),  // encrypted at app layer (ADR-0009)
  avatar: text('avatar'),  // encrypted at app layer
  ageGroup: text('age_group').notNull(),
  accessToken: text('access_token'),  // HMAC-SHA256 hashed (ADR-0002)
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  tokenVersion: integer('token_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ageGroupCheck: check('check_children_age_group', sql`${t.ageGroup} IN ('6-8', '9-11', '12-14')`),
  tokenIdx: index('idx_children_access_token').on(t.accessToken).where(sql`access_token IS NOT NULL`),
  familyIdx: index('idx_children_family').on(t.familyId),
}));

// === growth_dimensions === (ADR-0011)
export const growthDimensions = appSchema.table('growth_dimensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').references(() => families.id, { onDelete: 'cascade' }),  // NULL = global default
  code: text('code').notNull(),  // 'learning', 'sports', etc.
  name: text('name').notNull(),
  color: text('color').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  familyCodeUnique: uniqueIndex('idx_dimensions_family_code').on(t.familyId, t.code),
}));

// === tasks === (ADR-0011)
export const tasks = appSchema.table('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  dimensionId: uuid('dimension_id').notNull().references(() => growthDimensions.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description'),
  pointValue: integer('point_value').notNull(),
  difficulty: text('difficulty').notNull().default('easy'),
  difficultyMultiplier: integer('difficulty_multiplier').notNull().default(100),  // stored as %
  frequency: text('frequency').notNull().default('daily'),
  ageGroup: text('age_group').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  difficultyCheck: check('check_tasks_difficulty', sql`${t.difficulty} IN ('easy', 'medium', 'hard')`),
  frequencyCheck: check('check_tasks_frequency', sql`${t.frequency} IN ('daily', 'weekly')`),
  ageGroupCheck: check('check_tasks_age_group', sql`${t.ageGroup} IN ('6-8', '9-11', '12-14')`),
  pointValueCheck: check('check_tasks_point_value', sql`${t.pointValue} BETWEEN 1 AND 100`),
  familyIdx: index('idx_tasks_family').on(t.familyId),
  dimensionIdx: index('idx_tasks_dimension').on(t.dimensionId),
}));

// === checkins ===
export const checkins = appSchema.table('checkins', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  note: text('note'),
  revokedByParent: boolean('revoked_by_parent').notNull().default(false),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One check-in per task per day per child (unless revoked)
  uniqueCheckin: uniqueIndex('idx_checkins_child_task_date').on(t.childId, t.taskId, t.date),
  childDateIdx: index('idx_checkins_child_date').on(t.childId, t.date),
}));

// === point_transactions === (ADR-0003)
export const pointTransactions = appSchema.table('point_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  amountCheck: check('check_point_tx_amount', sql`${t.amount} <> 0`),
  sourceTypeCheck: check('check_point_tx_source_type', sql`${t.sourceType} IN ('task', 'reward', 'revocation')`),
  childCreatedIdx: index('idx_point_tx_child_created').on(t.childId, t.createdAt),
  // Conflict #4: partial unique index with child_id
  uniqueSource: uniqueIndex('uq_point_tx_source').on(t.childId, t.sourceType, t.sourceId)
    .where(sql`source_type IN ('task', 'reward', 'revocation')`),
}));

// === rewards === (ADR-0012)
export const rewards = appSchema.table('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  pointCost: integer('point_cost').notNull(),
  totalInventory: integer('total_inventory').notNull().default(999),
  totalClaimed: integer('total_claimed').notNull().default(0),
  weeklyLimitPerChild: integer('weekly_limit_per_child').notNull().default(1),
  icon: text('icon'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pointCostCheck: check('check_rewards_point_cost', sql`${t.pointCost} BETWEEN 1 AND 10000`),
  inventoryCheck: check('check_rewards_inventory', sql`${t.totalClaimed} <= ${t.totalInventory}`),
  familyIdx: index('idx_rewards_family').on(t.familyId),
}));

// === reward_redemptions === (ADR-0004)
export const rewardRedemptions = appSchema.table('reward_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  rewardId: uuid('reward_id').notNull().references(() => rewards.id, { onDelete: 'cascade' }),
  pointCost: integer('point_cost').notNull(),  // snapshot at redemption time
  status: text('status').notNull().default('pending'),
  parentNote: text('parent_note'),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusCheck: check('check_redemption_status',
    sql`${t.status} IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled')`),
  childIdx: index('idx_redemptions_child').on(t.childId),
  rewardIdx: index('idx_redemptions_reward').on(t.rewardId),
  statusIdx: index('idx_redemptions_status').on(t.status),
}));

// === weekly_reviews === (ADR-0005)
export const weeklyReviews = appSchema.table('weekly_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  weekStartDate: date('week_start_date').notNull(),
  bestThing: text('best_thing'),
  difficulty: text('difficulty'),
  childRequest: text('child_request'),
  childCommittedAt: timestamp('child_committed_at', { withTimezone: true }),
  parentObservation: text('parent_observation'),
  parentCommittedAt: timestamp('parent_committed_at', { withTimezone: true }),
  taskCount: integer('task_count'),
  pointEarned: integer('point_earned'),
  dimensionCount: integer('dimension_count'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueWeek: uniqueIndex('idx_weekly_reviews_child_week').on(t.childId, t.weekStartDate),
  // CHECK constraint for valid commit states (ADR-0005)
  commitStateCheck: check('check_review_commit_state', sql`
    (${t.childCommittedAt} IS NULL AND ${t.parentCommittedAt} IS NULL)
    OR (${t.childCommittedAt} IS NOT NULL AND ${t.parentCommittedAt} IS NULL AND ${t.lockedAt} IS NULL)
    OR (${t.childCommittedAt} IS NULL AND ${t.parentCommittedAt} IS NOT NULL AND ${t.lockedAt} IS NULL)
    OR (${t.childCommittedAt} IS NOT NULL AND ${t.parentCommittedAt} IS NOT NULL AND ${t.lockedAt} IS NOT NULL)
  `),
}));

// === weekly_review_access_log === (ADR-0005, Conflict #5)
export const weeklyReviewAccessLog = appSchema.table('weekly_review_access_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  reviewId: uuid('review_id').notNull().references(() => weeklyReviews.id, { onDelete: 'cascade' }),
  readerRole: text('reader_role').notNull(),
  fieldRead: text('field_read').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  readerRoleCheck: check('check_access_log_reader', sql`${t.readerRole} IN ('child', 'parent', 'system')`),
}));

// === growth_diaries === (ADR-0014, ADR-0009 encryption)
export const growthDiaries = appSchema.table('growth_diaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  title: text('title'),  // encrypted at app layer
  content: text('content'),  // encrypted at app layer
  category: text('category').notNull().default('reflection'),
  weekStartDate: date('week_start_date'),
  createdByChild: boolean('created_by_child').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  categoryCheck: check('check_diary_category',
    sql`${t.category} IN ('achievement', 'reflection', 'goal', 'memory')`),
  childIdx: index('idx_diaries_child').on(t.childId),
  createdIdx: index('idx_diaries_created').on(t.childId, t.createdAt),
}));

// === notifications === (ADR-0013)
export const notifications = appSchema.table('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  childId: uuid('child_id').references(() => children.id, { onDelete: 'cascade' }),
  recipientRole: text('recipient_role').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  isRead: boolean('is_read').notNull().default(false),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  recipientRoleCheck: check('check_notif_recipient', sql`${t.recipientRole} IN ('parent', 'child')`),
  familyIdx: index('idx_notif_family').on(t.familyId),
  unreadIdx: index('idx_notif_unread').on(t.familyId, t.isRead),
}));

// === audit_logs === (ADR-0015)
export const auditLogs = appSchema.table('audit_logs', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  familyId: uuid('family_id').references(() => families.id, { onDelete: 'cascade' }),
  actorRole: text('actor_role').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  metadata: jsonb('metadata'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  actorRoleCheck: check('check_audit_actor', sql`${t.actorRole} IN ('parent', 'child', 'system')`),
  familyIdx: index('idx_audit_family').on(t.familyId, t.createdAt),
}));

// === conflict_alerts === (ADR-0011, offline sync)
export const conflictAlerts = appSchema.table('conflict_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  childId: uuid('child_id').references(() => children.id, { onDelete: 'cascade' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  familyIdx: index('idx_conflict_family').on(t.familyId, t.resolvedAt),
}));
