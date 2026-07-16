import {
  sqliteTable, text, integer, uniqueIndex, index, check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// === families ===
export const families = sqliteTable('families', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// === parents ===
export const parents = sqliteTable('parents', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  email: text('email'),
  phone: text('phone'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  emailUnique: uniqueIndex('idx_parents_email').on(t.email).where(sql`email IS NOT NULL`),
  phoneUnique: uniqueIndex('idx_parents_phone').on(t.phone).where(sql`phone IS NOT NULL`),
}));

// === children ===
export const children = sqliteTable('children', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  name: text('name'),
  avatar: text('avatar'),
  ageGroup: text('age_group').notNull(),
  accessToken: text('access_token'),
  tokenExpiresAt: text('token_expires_at'),
  tokenVersion: integer('token_version').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  ageGroupCheck: check('check_children_age_group', sql`${t.ageGroup} IN ('6-8', '9-11', '12-14')`),
  tokenIdx: index('idx_children_access_token').on(t.accessToken).where(sql`access_token IS NOT NULL`),
  familyIdx: index('idx_children_family').on(t.familyId),
}));

// === growth_dimensions === (ADR-0011)
export const growthDimensions = sqliteTable('growth_dimensions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  familyCodeUnique: uniqueIndex('idx_dimensions_family_code').on(t.familyId, t.code),
}));

// === tasks === (ADR-0011)
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  dimensionId: text('dimension_id').notNull().references(() => growthDimensions.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description'),
  pointValue: integer('point_value').notNull(),
  difficulty: text('difficulty').notNull().default('easy'),
  difficultyMultiplier: integer('difficulty_multiplier').notNull().default(100),
  frequency: text('frequency').notNull().default('daily'),
  ageGroup: text('age_group').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  difficultyCheck: check('check_tasks_difficulty', sql`${t.difficulty} IN ('easy', 'medium', 'hard')`),
  frequencyCheck: check('check_tasks_frequency', sql`${t.frequency} IN ('daily', 'weekly')`),
  ageGroupCheck: check('check_tasks_age_group', sql`${t.ageGroup} IN ('6-8', '9-11', '12-14')`),
  pointValueCheck: check('check_tasks_point_value', sql`${t.pointValue} BETWEEN 1 AND 100`),
  familyIdx: index('idx_tasks_family').on(t.familyId),
  dimensionIdx: index('idx_tasks_dimension').on(t.dimensionId),
}));

// === checkins ===
export const checkins = sqliteTable('checkins', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  childId: text('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  note: text('note'),
  revokedByParent: integer('revoked_by_parent', { mode: 'boolean' }).notNull().default(false),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  uniqueCheckin: uniqueIndex('idx_checkins_child_task_date').on(t.childId, t.taskId, t.date),
  childDateIdx: index('idx_checkins_child_date').on(t.childId, t.date),
}));

// === point_transactions === (ADR-0003)
export const pointTransactions = sqliteTable('point_transactions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  childId: text('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  amountCheck: check('check_point_tx_amount', sql`${t.amount} <> 0`),
  sourceTypeCheck: check('check_point_tx_source_type', sql`${t.sourceType} IN ('task', 'reward', 'revocation')`),
  childCreatedIdx: index('idx_point_tx_child_created').on(t.childId, t.createdAt),
  uniqueSource: uniqueIndex('uq_point_tx_source').on(t.childId, t.sourceType, t.sourceId)
    .where(sql`source_type IN ('task', 'reward', 'revocation')`),
}));

// === rewards === (ADR-0012)
export const rewards = sqliteTable('rewards', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  pointCost: integer('point_cost').notNull(),
  totalInventory: integer('total_inventory').notNull().default(999),
  totalClaimed: integer('total_claimed').notNull().default(0),
  weeklyLimitPerChild: integer('weekly_limit_per_child').notNull().default(1),
  icon: text('icon'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pointCostCheck: check('check_rewards_point_cost', sql`${t.pointCost} BETWEEN 1 AND 10000`),
  inventoryCheck: check('check_rewards_inventory', sql`${t.totalClaimed} <= ${t.totalInventory}`),
  familyIdx: index('idx_rewards_family').on(t.familyId),
}));

// === reward_redemptions === (ADR-0004)
export const rewardRedemptions = sqliteTable('reward_redemptions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  childId: text('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  rewardId: text('reward_id').notNull().references(() => rewards.id, { onDelete: 'cascade' }),
  pointCost: integer('point_cost').notNull(),
  status: text('status').notNull().default('pending'),
  parentNote: text('parent_note'),
  redeemedAt: text('redeemed_at').notNull().$defaultFn(() => new Date().toISOString()),
  approvedAt: text('approved_at'),
  fulfilledAt: text('fulfilled_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  statusCheck: check('check_redemption_status',
    sql`${t.status} IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled')`),
  childIdx: index('idx_redemptions_child').on(t.childId),
  rewardIdx: index('idx_redemptions_reward').on(t.rewardId),
  statusIdx: index('idx_redemptions_status').on(t.status),
}));

// === weekly_reviews === (ADR-0005)
export const weeklyReviews = sqliteTable('weekly_reviews', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  childId: text('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  weekStartDate: text('week_start_date').notNull(),
  bestThing: text('best_thing'),
  difficulty: text('difficulty'),
  childRequest: text('child_request'),
  childCommittedAt: text('child_committed_at'),
  parentObservation: text('parent_observation'),
  parentCommittedAt: text('parent_committed_at'),
  taskCount: integer('task_count'),
  pointEarned: integer('point_earned'),
  dimensionCount: integer('dimension_count'),
  lockedAt: text('locked_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  uniqueWeek: uniqueIndex('idx_weekly_reviews_child_week').on(t.childId, t.weekStartDate),
  commitStateCheck: check('check_review_commit_state', sql`
    (${t.childCommittedAt} IS NULL AND ${t.parentCommittedAt} IS NULL)
    OR (${t.childCommittedAt} IS NOT NULL AND ${t.parentCommittedAt} IS NULL AND ${t.lockedAt} IS NULL)
    OR (${t.childCommittedAt} IS NULL AND ${t.parentCommittedAt} IS NOT NULL AND ${t.lockedAt} IS NULL)
    OR (${t.childCommittedAt} IS NOT NULL AND ${t.parentCommittedAt} IS NOT NULL AND ${t.lockedAt} IS NOT NULL)
  `),
}));

// === weekly_review_access_log === (ADR-0005, Conflict #5)
export const weeklyReviewAccessLog = sqliteTable('weekly_review_access_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reviewId: text('review_id').notNull().references(() => weeklyReviews.id, { onDelete: 'cascade' }),
  readerRole: text('reader_role').notNull(),
  fieldRead: text('field_read').notNull(),
  readAt: text('read_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  readerRoleCheck: check('check_access_log_reader', sql`${t.readerRole} IN ('child', 'parent', 'system')`),
}));

// === growth_diaries === (ADR-0014, ADR-0009 encryption)
export const growthDiaries = sqliteTable('growth_diaries', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  childId: text('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  title: text('title'),
  content: text('content'),
  category: text('category').notNull().default('reflection'),
  weekStartDate: text('week_start_date'),
  createdByChild: integer('created_by_child', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  categoryCheck: check('check_diary_category',
    sql`${t.category} IN ('achievement', 'reflection', 'goal', 'memory')`),
  childIdx: index('idx_diaries_child').on(t.childId),
  createdIdx: index('idx_diaries_created').on(t.childId, t.createdAt),
}));

// === notifications === (ADR-0013)
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  childId: text('child_id').references(() => children.id, { onDelete: 'cascade' }),
  recipientRole: text('recipient_role').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  recipientRoleCheck: check('check_notif_recipient', sql`${t.recipientRole} IN ('parent', 'child')`),
  familyIdx: index('idx_notif_family').on(t.familyId),
  unreadIdx: index('idx_notif_unread').on(t.familyId, t.isRead),
}));

// === audit_logs === (ADR-0015)
export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
  actorRole: text('actor_role').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: text('metadata'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  actorRoleCheck: check('check_audit_actor', sql`${t.actorRole} IN ('parent', 'child', 'system')`),
  familyIdx: index('idx_audit_family').on(t.familyId, t.createdAt),
}));

// === conflict_alerts === (ADR-0011, offline sync)
export const conflictAlerts = sqliteTable('conflict_alerts', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  childId: text('child_id').references(() => children.id, { onDelete: 'cascade' }),
  resolvedAt: text('resolved_at'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  familyIdx: index('idx_conflict_family').on(t.familyId, t.resolvedAt),
}));
