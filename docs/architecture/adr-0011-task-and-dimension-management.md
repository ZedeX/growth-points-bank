# ADR-0011: Task and Dimension Management

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 + TypeScript 5 |
| Domain | Task Management / Growth Dimension Configuration |
| Knowledge Risk | LOW — standard CRUD + enum filtering + soft-delete; no exotic APIs |
| References Consulted | PRD §3.1 (Growth Map + 5 dimensions), §5.1 (ER: Task n─1 Dimension), §9 Grilling #3 / #7 / #8; DETAILED_DESIGN §2 (domain model), §4.2–4.3 (visibility algorithms), §11 (schema) |
| Post-Cutoff APIs Used | None |
| Verification Required | age_group filter test (6-8 child sees NULL + 6-8 tasks only); offline conflict alert inserted on stale `client_updated_at` |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0002 (Auth — parent/child JWT), ADR-0006 (Multi-tenant `family_id` scoping), ADR-0003 (Points Integrity — `recordPointsTx` consumes `effective_points`) |
| Enables | Epics "Task Management" (parent), "Growth Map" (child), "Daily Check-in" |
| Blocks | None |
| Ordering Note | Must be Accepted before task CRUD stories begin; supersedes DETAILED_DESIGN §11 `dimensions` table (was global, now family-scoped) |

## Context

### Problem Statement
The app needs a task + growth-dimension model that supports: (a) parents creating per-family custom tasks, (b) family-scoped custom growth dimensions (the DETAILED_DESIGN §11 schema incorrectly models dimensions as global predefined rows — that must be revised), (c) age-group adaptation so a 6-8 child does not see a 12-14 task, (d) a point-value formula richer than a flat integer (base × difficulty multiplier), (e) offline conflict handling where a parent edits a task on a stale client, and (f) sibling visibility within a family (multi-tenant filter operates at family level, not child level).

### Constraints
- All task/dimension tables live in the `app` schema via Drizzle `pgSchema('app')`.
- All primary keys are UUID (the BIGSERIAL exception in ADR-0005 is audit-log only).
- `family_id` is mandatory on every row (ADR-0006); cross-family access returns 404, not 403.
- Soft-delete only via `is_active = false`; no hard deletes — historical `checkins` reference `tasks.id` and must remain valid.
- Dimension names and task titles are family-defined content, **not PII** → stored plain text (ADR-0009 encryption applies to child PII like names/diaries, not to task content).
- Repository layer takes `familyId` as first param on every method (ADR-0006 `tenantScope` pattern).

### Requirements
- **TR-tasks-001**: Parent CRUD on tasks (create / read / update / archive).
- **TR-tasks-002**: Task categorization — `frequency` (daily/weekly/once) + `dimension_id` assignment (nullable for "uncategorized").
- **TR-tasks-003**: `age_group` adaptation (Grilling #7) — tasks target '6-8' / '9-11' / '12-14' or NULL (all ages); child view filters accordingly.
- **TR-tasks-004**: Visibility rules — sibling visibility within family (Grilling #3) + offline conflict last-write-wins with alert (Grilling #8).
- **TR-tasks-006**: Point value = `point_value × difficulty_multiplier` (rounded).
- **TR-tasks-007**: Family-scoped custom growth dimensions; defaults seeded on family creation; defaults archivable but not hard-deletable.

## Decision

### Drizzle Schema (`app` schema, UUID PKs)

```typescript
// src/server/db/schema.ts (excerpt)
import { pgSchema, pgTable, uuid, text, integer, real, boolean,
         timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const frequencyEnum = pgEnum('frequency', ['daily', 'weekly', 'once']);
export const ageGroupEnum = pgEnum('age_group', ['6-8', '9-11', '12-14']);

// ---- Growth Dimensions (family-scoped; supersedes DETAILED_DESIGN §11 global dimensions) ----
export const growthDimensions = appSchema.table('growth_dimensions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  familyId:  uuid('family_id').notNull().references(() => families.id),
  name:      text('name').notNull(),                 // family content, NOT PII → plain
  slug:      text('slug').notNull(),                 // URL/UI key, e.g. "exercise"
  sortOrder: integer('sort_order').notNull().default(0),
  isActive:  boolean('is_active').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),  // protects defaults from hard-delete
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Tasks (family-scoped) ----
export const tasks = appSchema.table('tasks', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  familyId:            uuid('family_id').notNull().references(() => families.id),
  title:               text('title').notNull(),                  // family content, NOT PII → plain
  description:         text('description'),
  dimensionId:         uuid('dimension_id').references(() => growthDimensions.id),  // nullable = uncategorized
  frequency:           frequencyEnum('frequency').notNull(),
  ageGroup:            ageGroupEnum('age_group'),                // nullable = all ages
  pointValue:          integer('point_value').notNull(),         // base points, CHECK >= 1
  difficultyMultiplier: real('difficulty_multiplier').notNull().default(1.0),  // CHECK 0.5..3.0
  isActive:            boolean('is_active').notNull().default(true),
  createdBy:           uuid('created_by').references(() => parents.id),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastModifiedAt:      timestamp('last_modified_at', { withTimezone: true }).notNull().defaultNow(),  // offline conflict (Grilling #8)
});
```

### SQL Constraints

```sql
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_point_value_check CHECK (point_value >= 1),
  ADD CONSTRAINT tasks_difficulty_multiplier_check
    CHECK (difficulty_multiplier >= 0.5 AND difficulty_multiplier <= 3.0);

-- Soft-uniqueness: one active slug per family
CREATE UNIQUE INDEX uq_growth_dimensions_family_slug
  ON app.growth_dimensions (family_id, slug) WHERE is_active = true;

CREATE INDEX idx_tasks_family_active    ON app.tasks (family_id, is_active);
CREATE INDEX idx_tasks_family_dimension ON app.tasks (family_id, dimension_id);
CREATE INDEX idx_tasks_family_age       ON app.tasks (family_id, age_group);
```

### Default Dimensions (seeded on family creation)

Per PRD §3.1 the five default growth dimensions are: **学习力 / 运动力 / 自控力 / 探索力 / 实践力** (study / exercise / self-control / exploration / practice). On `families` row insert, a seed hook inserts five `growth_dimensions` rows with `is_default = true`. Parents may **add / rename / reorder** any dimension and may **archive** defaults (`is_active = false`), but the API refuses to hard-delete a row where `is_default = true` — referential integrity for historical checkins must be preserved.

### State Machine

Task lifecycle is a two-state soft-delete machine: `active` ↔ `archived`, toggled via `is_active`. No hard-delete endpoint exists in MVP. Archiving a task does NOT cascade to historical `checkins` — they retain their `task_id` reference and the task row remains readable for audit/diary context.

```
   [create] ──> active  <──is_active=false──>  archived
                     └────────is_active=true─────────┘
```

### Point Value Computation

```typescript
// packages/shared/src/domain/points.ts
export function computeEffectivePoints(task: {
  pointValue: number;
  difficultyMultiplier: number;
}): number {
  // PRD §3.1: base points × difficulty multiplier; integer rounding
  return Math.round(task.pointValue * task.difficultyMultiplier);
}
```

Family sets `pointValue` (e.g., 5). `difficultyMultiplier` defaults to 1.0; 1.5 for hard tasks, 0.5 for easy. The check-in flow (ADR-0003 `recordPointsTx`) credits `computeEffectivePoints(task)` as the `amount`. The `difficulty_multiplier` is captured at check-in time on the `point_transactions` audit trail by storing the resulting amount; if a parent later edits the task's multiplier, historical transactions are NOT restated.

### Visibility Rules

**Sibling visibility (Grilling #3).** Multi-tenant filtering (ADR-0006) operates at the `family_id` level, not the `child_id` level. A child JWT therefore MAY read sibling checkin/task-completion status within the same family. The PRD §6 `families.achievement_wall_enabled` toggle controls whether the UI **surfaces** sibling dimension-lighting status; when enabled, siblings see each other's dimension lighting but **never** see each other's points numbers (PRD §6). Backend enforcement: child-scoped read endpoints filter by `family_id` only; points endpoints additionally filter by `child_id = request.auth.sub`.

**Offline conflict (Grilling #8).** Last-write-wins + alert. Every `PATCH /tasks/{id}` carries `client_updated_at`. If `client_updated_at < server.last_modified_at`, the server **accepts the write** (last-write-wins) but inserts a row into `conflict_alerts` for the parent to review:

```typescript
// src/server/services/task-conflict.ts
async function applyWithConflictCheck(
  familyId: string, taskId: string,
  clientUpdatedAt: Date, patch: UpdateTaskInput,
) {
  const existing = await taskRepo.findById(familyId, taskId);
  if (!existing) throw new NotFoundError();

  if (clientUpdatedAt < existing.lastModifiedAt) {
    await db.insert(conflictAlerts).values({
      familyId, resourceId: taskId, resourceType: 'task',
      serverVersion: existing.lastModifiedAt,
      clientVersion: clientUpdatedAt,
      details: { patch },
    });
    logger.warn({ familyId, taskId }, 'Offline conflict; accepting last-write + alert');
  }
  return taskRepo.update(familyId, taskId, patch);  // updates last_modified_at = NOW()
}
```

The write is never blocked — Grilling #8 explicitly chose last-write + alert over reject, to avoid stranding a parent who edited offline.

### Age Group Adaptation (Grilling #7)

Each task targets one age group OR is "all ages" (`age_group IS NULL`). The child task-list endpoint filters:

```typescript
// WHERE age_group IS NULL OR age_group = child.age_group
async listForChild(familyId: string, childAgeGroup: string) {
  return db.query.tasks.findMany({
    where: and(
      eq(tasks.familyId, familyId),
      eq(tasks.isActive, true),
      or(eq(tasks.ageGroup, childAgeGroup), isNull(tasks.ageGroup)),
    ),
  });
}
```

Parent UI shows an `age_group` selector when creating/editing a task (options: 6-8 / 9-11 / 12-14 / all ages). Default at creation time is NULL (all ages) so a parent who ignores the field does not accidentally hide the task.

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST   | `/api/families/{familyId}/dimensions`       | parent | Create custom dimension |
| GET    | `/api/families/{familyId}/dimensions`       | parent | List dimensions (active + archived) |
| PATCH  | `/api/families/{familyId}/dimensions/{id}`  | parent | Rename / reorder |
| DELETE | `/api/families/{familyId}/dimensions/{id}`  | parent | Archive (soft-delete; refuses if `is_default`) |
| POST   | `/api/families/{familyId}/tasks`            | parent | Create task |
| GET    | `/api/families/{familyId}/tasks`            | parent | List (filters: `dimension_id`, `age_group`, `is_active`) |
| GET    | `/api/families/{familyId}/tasks/{id}`       | parent | Get one |
| PATCH  | `/api/families/{familyId}/tasks/{id}`       | parent | Update (carries `client_updated_at`) |
| DELETE | `/api/families/{familyId}/tasks/{id}`       | parent | Archive (soft-delete) |
| GET    | `/api/children/{childId}/tasks`             | child  | Child view (filtered by child's `age_group`) |

All parent endpoints require parent JWT (ADR-0002). The child endpoint requires child JWT and the `childId` path param must equal `request.auth.sub` (otherwise 404). All endpoints pass through the ADR-0006 tenant filter — `request.familyId` is injected from the JWT claim, never from the request body.

### Repository Layer

Follows ADR-0006's `tenantScope(familyId)` pattern. Every method takes `familyId` first; cross-family access returns `null` → controller maps to 404.

```typescript
// src/server/repositories/task-repo.ts
export const taskRepo = {
  async findById(familyId: string, taskId: string) {
    return db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), eq(tasks.familyId, familyId)),
    });
  },
  async list(familyId: string, filters: TaskFilters = {}) {
    return db.query.tasks.findMany({
      where: and(
        eq(tasks.familyId, familyId),
        filters.dimensionId ? eq(tasks.dimensionId, filters.dimensionId) : undefined,
        filters.ageGroup ? or(eq(tasks.ageGroup, filters.ageGroup), isNull(tasks.ageGroup)) : undefined,
        filters.isActive !== undefined ? eq(tasks.isActive, filters.isActive) : undefined,
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  },
  async create(familyId: string, createdBy: string, input: CreateTaskInput) {
    const [row] = await db.insert(tasks).values({ ...input, familyId, createdBy }).returning();
    return row;
  },
  async update(familyId: string, taskId: string, patch: UpdateTaskInput) {
    const [row] = await db.update(tasks)
      .set({ ...patch, lastModifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.familyId, familyId)))
      .returning();
    return row ?? null;
  },
  async archive(familyId: string, taskId: string) {
    return this.update(familyId, taskId, { isActive: false });
  },
};
```

### Validation (Zod, in `packages/shared`)

```typescript
// packages/shared/src/schemas/task.ts
import { z } from 'zod';

export const createTaskSchema = z.object({
  title:                z.string().min(1).max(100),
  description:          z.string().max(1000).optional(),
  dimensionId:          z.string().uuid().nullable().optional(),
  frequency:            z.enum(['daily', 'weekly', 'once']),
  ageGroup:             z.enum(['6-8', '9-11', '12-14']).nullable().optional(),
  pointValue:           z.number().int().min(1).max(100),
  difficultyMultiplier: z.number().min(0.5).max(3.0).step(0.1).default(1.0),
});

export const updateTaskSchema = createTaskSchema.partial();

export const createDimensionSchema = z.object({
  name: z.string().min(1).max(30),
  slug: z.string().regex(/^[a-z0-9-]+$/),
});
```

## Alternatives Considered

### Alternative 1: Global predefined dimensions (DETAILED_DESIGN §11 original)
- **Description**: Keep `dimensions` as a global table with integer PKs 1-5, no `family_id`, shared across all families.
- **Pros**: Simpler schema; less data; no per-family seed step.
- **Cons**: Families cannot add/rename dimensions (PRD §3.1 explicitly allows "家长可新增维度"); violates TR-tasks-007; forces all families into the same dimension vocabulary.
- **Rejection Reason**: TR-tasks-007 requires family-scoped custom dimensions; global table cannot satisfy the requirement.

### Alternative 2: Hard delete for tasks and dimensions
- **Description**: `DELETE` removes the row; cascade-null or cascade-delete historical checkins.
- **Pros**: Smaller tables; no `is_active` noise.
- **Cons**: Breaks referential integrity of `checkins.task_id` and `point_transactions.source_id`; loses audit context for past point awards; PRD §7.3 implies data retention for growth archive.
- **Rejection Reason**: Soft-delete preserves historical integrity; archive is reversible and audit-safe.

### Alternative 3: Reject offline conflicting writes (pessimistic)
- **Description**: If `client_updated_at < server.last_modified_at`, return 409 and refuse the write.
- **Pros**: No data loss; explicit conflict resolution.
- **Cons**: Strands a parent who edited offline and reconnects; forces them to re-apply changes blind; contradicts Grilling #8's explicit decision ("最后写入+告警").
- **Rejection Reason**: Grilling #8 chose last-write-wins + alert specifically to avoid blocking offline edits.

### Alternative 4: Per-child task assignment (instead of age_group filter)
- **Description**: A join table `child_tasks` assigns each task to specific children.
- **Pros**: Precise per-child targeting.
- **Cons**: Explosive cardinality (N children × M tasks); parent UX becomes tedious; PRD §3.1 uses age groups, not per-child assignment.
- **Rejection Reason**: `age_group` filter matches PRD §3.1 and Grilling #7 ("任务模板按年龄分组") with far less data.

## Consequences

### Positive
- Family-scoped dimensions satisfy TR-tasks-007 and PRD §3.1's "家长可新增维度".
- `age_group` filter prevents a 6-8 child from seeing a 12-14 task (Grilling #7).
- `difficulty_multiplier` enables richer point values without per-task bespoke logic.
- Soft-delete preserves referential integrity for historical checkins and point transactions.
- `last_modified_at` + `conflict_alerts` implements Grilling #8 without blocking offline parents.
- Repository `tenantScope(familyId)` pattern inherited from ADR-0006 keeps cross-family leaks impossible.

### Negative
- Diverges from DETAILED_DESIGN §11 `dimensions` table (was global integer-PK; now family-scoped UUID) — DETAILED_DESIGN must be updated to match.
- `difficulty_multiplier` captured at task-edit time is NOT restated on historical `point_transactions` — historical integrity preserved but a parent who retroactively lowers a multiplier cannot claw back already-awarded points.
- Sibling visibility within a family is a deliberate ADR-0006 consequence — the `achievement_wall_enabled` flag is the only UI gate; backend does not block cross-sibling reads within a family.
- Five default dimensions seeded per family means `growth_dimensions` grows linearly with family count (acceptable: ~5 rows × N families).

### Risks
- **Risk**: Parent archives a dimension that still has active tasks → **Mitigation**: `PATCH /dimensions/{id}` archive endpoint refuses (409) while active tasks reference it; parent must reassign or archive tasks first.
- **Risk**: Offline conflict alert spam if a parent's clock is skewed → **Mitigation**: `conflict_alerts` rows are advisory; UI surfaces at most one banner per task; alerts auto-expire after 30 days.
- **Risk**: `difficulty_multiplier` drift between task edit and check-in → **Mitigation**: `computeEffectivePoints` is called server-side at check-in time using the task row's current value; the resulting integer amount is stored on `point_transactions`, so the audit trail is self-describing.
- **Risk**: A family with many custom dimensions clutters the Growth Map UI → **Mitigation**: `sort_order` + `is_active` let parents archive unused dimensions; UI renders only active dimensions.

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.1 | 五大维度定义（学习力/运动力/自控力/探索力/实践力） | Seeded as `is_default=true` rows per family |
| §3.1 | 家长可新增维度 | `POST /api/families/{id}/dimensions` (TR-tasks-007) |
| §3.1 | 每个任务有固定积分值（由家长设定） | `pointValue` + `difficulty_multiplier` (TR-tasks-006) |
| §3.2 | 任务频率 daily/weekly/once | `frequencyEnum` (TR-tasks-002) |
| §5.1 | Task n─1 Dimension | `tasks.dimension_id` FK → `growth_dimensions.id` (nullable for uncategorized) |
| §6 | 任务模板按年龄段推荐（6-8/9-11/12-14） | `age_group` column + child-view filter (TR-tasks-003, Grilling #7) |
| §6 | 家庭成就墙开关 | Backend allows cross-sibling reads within family; UI gate via `families.achievement_wall_enabled` (TR-tasks-004, Grilling #3) |
| §9 Grilling #8 | 离线冲突：最后写入+告警 | `last_modified_at` + `conflict_alerts` table; write never blocked (TR-tasks-004) |

## Performance Implications
- **CPU**: Negligible — all queries are indexed `family_id` seeks; `computeEffectivePoints` is one `Math.round`.
- **Memory**: Negligible — no in-memory caching of tasks/dimensions.
- **Load Time**: Task list for a family is < 50 rows typical; indexed query < 5ms.
- **Network**: One round-trip per task/dimension endpoint; child task view is a single query with `OR` filter on `age_group`.
- **Indexing**: `idx_tasks_family_active`, `idx_tasks_family_dimension`, `idx_tasks_family_age` cover the hot query paths.

## Migration Plan
N/A — new codebase. **Note**: This ADR supersedes the `dimensions` table definition in DETAILED_DESIGN §11 (which modeled dimensions as a global integer-PK table with no `family_id`). DETAILED_DESIGN §11 must be updated to match this ADR's `growth_dimensions` family-scoped table before implementation begins. The `tasks` table in DETAILED_DESIGN §11 is extended here with `age_group`, `difficulty_multiplier`, `created_by`, and `last_modified_at` columns.

## Validation Criteria
- [ ] Parent can create / read / update / archive a task (TR-tasks-001)
- [ ] Task `frequency` and `dimension_id` persist correctly (TR-tasks-002)
- [ ] Child aged 6-8 sees only tasks where `age_group IS NULL OR age_group = '6-8'` (TR-tasks-003, Grilling #7)
- [ ] Child JWT can read sibling task-completion status within same family; cross-family access returns 404 (TR-tasks-004, Grilling #3)
- [ ] `PATCH /tasks/{id}` with stale `client_updated_at` succeeds AND inserts a `conflict_alerts` row (TR-tasks-004, Grilling #8)
- [ ] `computeEffectivePoints({ pointValue: 5, difficultyMultiplier: 1.5 })` returns `8` (TR-tasks-006)
- [ ] Parent can create a custom dimension; default dimensions seeded on family creation (TR-tasks-007)
- [ ] `DELETE /dimensions/{id}` on a default dimension returns 409 (TR-tasks-007)
- [ ] Cross-family access to any task/dimension endpoint returns 404 (ADR-0006)
- [ ] Default dimension seed list confirmed against PRD §3.1 (5 dimensions: 学习力/运动力/自控力/探索力/实践力)
- [ ] Zod validation rejects `pointValue < 1`, `difficultyMultiplier > 3.0`, `title > 100 chars`
- [ ] DETAILED_DESIGN §11 updated to replace global `dimensions` table with family-scoped `growth_dimensions`

## Related Decisions
- ADR-0001 (Tech Stack — provides Drizzle + Postgres)
- ADR-0002 (Auth — parent/child JWT provides `family_id` claim)
- ADR-0003 (Points Integrity — `recordPointsTx` consumes `computeEffectivePoints(task)` as the credit amount)
- ADR-0005 (Audit Log — BIGSERIAL exception does not apply here; tasks/dimensions use UUID PKs)
- ADR-0006 (Multi-tenant Isolation — `tenantScope(familyId)` repository pattern is reused verbatim)
- ADR-0009 (Data Encryption — does NOT apply to task titles or dimension names; they are family content, not child PII)
- ADR-0010 (Background Jobs — daily/weekly reset is implicit via dated `checkins`; no cron action on `tasks` table)
