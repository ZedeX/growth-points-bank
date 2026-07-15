# ADR-0012: Reward Management (CRUD, Inventory, Per-Child Weekly Limits)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 + Zod |
| Domain | Domain Logic / Reward Catalog |
| Knowledge Risk | LOW — CRUD + atomic counter pattern is foundational |
| References Consulted | PRD §3.4 (奖励兑换), DETAILED_DESIGN §2 (domain model), §3 (redemption flow), §11 (rewards schema) |
| Post-Cutoff APIs Used | None |
| Verification Required | Atomic inventory decrement under concurrent redemption; weekly limit enforcement inside SERIALIZABLE tx |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0003 (Points Integrity), ADR-0006 (Multi-Tenant Isolation) |
| Enables | ADR-0004 (Redemption State Machine — consumes `rewards` rows), Epic "Reward Redemption" |
| Blocks | None |
| Ordering Note | Must be Accepted before ADR-0004's redemption endpoints can run; `reward_redemptions.reward_id` FK targets this table |

## Context

### Problem Statement
PRD §3.4 defines a tiered reward catalog that parents curate per family. A reward has a point cost, an optional total inventory, and an optional per-child weekly redemption limit. Children browse the catalog and submit redemptions (handled by ADR-0004); parents create, edit, and archive rewards.

This ADR defines the `rewards` table, its lifecycle, inventory accounting, and the per-child weekly cap. It does **not** redefine `reward_redemptions` (owned by ADR-0004) — it only declares the FK target and the `point_cost` snapshot source that ADR-0004 consumes.

### Constraints
- `rewards` lives in the `app` schema (Drizzle `pgSchema('app')`); UUID PKs throughout
- `family_id` is mandatory on every row (ADR-0006 tenant scoping)
- Soft-delete only (archive via `is_active=false`); hard deletes would orphan historical `reward_redemptions` rows and break point audit trail
- `total_claimed` is system-managed via atomic UPDATE; never user-editable
- `point_cost` edits do **not** affect existing redemptions — ADR-0004 snapshots `reward_redemptions.point_cost` at redemption time
- Family-defined `title`/`description` are plain content, not PII

### Requirements
- **TR-rewards-001**: Parent CRUD — create, edit, archive (no hard delete) rewards
- **TR-rewards-002**: Reward inventory (`total_inventory`) and per-child weekly redemption limits (`weekly_limit_per_child`)
- Inventory decrement must be atomic under concurrent redemption (no oversell)
- Weekly limit check must run inside the SERIALIZABLE redemption transaction (ADR-0003) to prevent races
- Cross-family access returns 404 (ADR-0006)

## Decision

### Data Model — `rewards` Table

```typescript
// apps/api/src/server/db/schema/rewards.ts
import { pgSchema, uuid, text, integer, boolean, timestamp, pgEnum } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { families, parents } from './families.js';

export const appSchema = pgSchema('app');

export const rewardTierEnum = pgEnum('reward_tier', ['small', 'medium', 'large']);

export const rewards = appSchema.table('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id),
  title: text('title').notNull(),                 // 1-50 chars, validated in Zod
  description: text('description'),
  pointCost: integer('point_cost').notNull(),      // CHECK >= 1
  tier: rewardTierEnum('tier').notNull(),          // 'small' | 'medium' | 'large'
  icon: text('icon'),                              // emoji or icon URL
  isActive: boolean('is_active').notNull().default(true),
  weeklyLimitPerChild: integer('weekly_limit_per_child'),  // NULL = unlimited
  totalInventory: integer('total_inventory'),              // NULL = unlimited
  totalClaimed: integer('total_claimed').notNull().default(0), // system-managed
  createdBy: uuid('created_by').references(() => parents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// DB-level guards
// CHECK (point_cost >= 1)
// CHECK (total_inventory IS NULL OR total_claimed <= total_inventory)
// UNIQUE (family_id, title) WHERE is_active = true  -- avoid duplicate active titles per family
// INDEX on (family_id, is_active)
```

```sql
ALTER TABLE app.rewards
  ADD CONSTRAINT rewards_point_cost_positive CHECK (point_cost >= 1),
  ADD CONSTRAINT rewards_inventory_consistent
    CHECK (total_inventory IS NULL OR total_claimed <= total_inventory);

CREATE INDEX idx_rewards_family_active ON app.rewards (family_id) WHERE is_active = true;
```

### State Machine — `active` ↔ `archived`

```typescript
// packages/shared/src/reward-lifecycle.ts
export const RewardLifecycle = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;

export type RewardLifecycle = typeof RewardLifecycle[keyof typeof RewardLifecycle];

// Transitions
// active  -> archived  (parent archive; sets is_active = false)
// archived -> active   (parent restore; sets is_active = true)
// NO hard DELETE — referential integrity to reward_redemptions must be preserved.
//
// Semantics when archived:
//   - Existing pending redemptions STILL PROCESS (ADR-0004 state machine continues)
//   - NEW redemptions are rejected (409 / 410) — archived rewards are hidden from child catalog
//   - weekly_limit / inventory checks skip archived rewards
```

### Inventory Tracking — Atomic Decrement

```sql
-- Run INSIDE the SERIALIZABLE redemption transaction (ADR-0003/ADR-0004).
-- Atomically reserves one unit; returns 0 rows if sold out.
UPDATE app.rewards
SET total_claimed = total_claimed + 1,
    updated_at = NOW()
WHERE id = $1
  AND family_id = $familyId            -- ADR-0006 tenant scope
  AND is_active = true
  AND (total_inventory IS NULL OR total_claimed < total_inventory)
RETURNING *;

-- If 0 rows returned:
--   - reward missing / wrong family / archived  -> 404 (do not confirm existence)
--   - sold out                                  -> 409 Conflict { code: 'reward_sold_out' }
```

### Per-Child Weekly Limit Check

```sql
-- Inside the SAME SERIALIZABLE transaction, AFTER inventory decrement succeeds.
SELECT COUNT(*) AS week_count
FROM app.reward_redemptions
WHERE child_id = $childId
  AND reward_id = $rewardId
  AND created_at >= date_trunc('week', CURRENT_DATE);

-- If reward.weekly_limit_per_child IS NOT NULL
--    AND week_count >= reward.weekly_limit_per_child THEN
--   ROLLBACK (release the reserved inventory unit) and return
--   409 { code: 'weekly_limit_exceeded' }
```

Ordering matters: reserve inventory first, then check weekly limit. If the weekly limit fails, the transaction rolls back and the inventory reservation is released atomically. Checking weekly limit *before* reserving inventory would allow a race where two concurrent requests both pass the limit check.

### Point Cost Snapshot (delegated to ADR-0004)

`reward_redemptions.point_cost` is a SNAPSHOT of `rewards.point_cost` captured at redemption time. If a parent later edits `rewards.point_cost`, pending and historical redemptions retain their original snapshot. This ADR guarantees the source column (`rewards.point_cost`) is freely editable; ADR-0004 guarantees the snapshot column is immutable post-INSERT.

### API Endpoints — Parent

| Method | Path | Purpose |
|--------|------|---------|
| POST   | `/api/families/{familyId}/rewards` | Create reward |
| GET    | `/api/families/{familyId}/rewards` | List (filter: `is_active`, `tier`) |
| GET    | `/api/families/{familyId}/rewards/{id}` | Get one |
| PATCH  | `/api/families/{familyId}/rewards/{id}` | Update (`title`, `description`, `point_cost`, `tier`, `weekly_limit_per_child`, `total_inventory`, `is_active`) — `total_claimed` NOT editable |
| DELETE | `/api/families/{familyId}/rewards/{id}` | Archive (soft-delete: sets `is_active=false`) |

### API Endpoints — Child (read-only)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/children/{childId}/rewards` | List active rewards visible to child, each annotated with the child's own current weekly redemption count |
| GET | `/api/children/{childId}/rewards/{id}` | Preview a reward (does NOT create a redemption) |

Child endpoints filter by `request.childId` from auth (ADR-0006 Pattern 4) and only return `is_active = true` rewards.

### Repository Layer — `tenantScope(familyId)` (ADR-0006)

```typescript
// apps/api/src/server/repositories/reward-repo.ts
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rewards } from '../db/schema/rewards.js';

export const rewardRepo = {
  async findById(familyId: string, rewardId: string) {
    return db.query.rewards.findFirst({
      where: and(eq(rewards.id, rewardId), eq(rewards.familyId, familyId)),
    });
  },

  async list(familyId: string, opts: { isActive?: boolean; tier?: 'small' | 'medium' | 'large' }) {
    return db.query.rewards.findMany({
      where: and(
        eq(rewards.familyId, familyId),
        opts.isActive !== undefined ? eq(rewards.isActive, opts.isActive) : undefined,
        opts.tier ? eq(rewards.tier, opts.tier) : undefined,
      ),
      orderBy: [rewards.createdAt],
    });
  },

  async create(familyId: string, createdBy: string, input: RewardCreateInput) {
    return db.insert(rewards).values({ ...input, familyId, createdBy }).returning();
  },

  async update(familyId: string, rewardId: string, patch: RewardUpdateInput) {
    // total_claimed is never accepted here — system-managed only.
    return db.update(rewards)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(rewards.id, rewardId), eq(rewards.familyId, familyId)))
      .returning();
  },

  async archive(familyId: string, rewardId: string) {
    return db.update(rewards)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(rewards.id, rewardId), eq(rewards.familyId, familyId)))
      .returning();
  },

  /** Atomic inventory reservation. Returns the updated row or null if sold out / missing / archived. */
  async reserveInventory(familyId: string, rewardId: string) {
    const rows = await db.execute(sql`
      UPDATE app.rewards
      SET total_claimed = total_claimed + 1, updated_at = NOW()
      WHERE id = ${rewardId}
        AND family_id = ${familyId}
        AND is_active = true
        AND (total_inventory IS NULL OR total_claimed < total_inventory)
      RETURNING *
    `);
    return rows.rows[0] ?? null;
  },
};
```

### Validation — Zod Schemas

```typescript
// packages/shared/src/schemas/reward.ts
import { z } from 'zod';

export const createRewardSchema = z.object({
  title: z.string().min(1).max(50),
  description: z.string().nullable().optional(),
  pointCost: z.number().int().min(1).max(10000),
  tier: z.enum(['small', 'medium', 'large']),
  icon: z.string().nullable().optional(),
  weeklyLimitPerChild: z.number().int().positive().nullable().optional(),
  totalInventory: z.number().int().positive().nullable().optional(),
});

export const updateRewardSchema = createRewardSchema.partial().extend({
  isActive: z.boolean().optional(),
  // total_claimed is intentionally ABSENT — system-managed via reserveInventory only.
});

export type RewardCreateInput = z.infer<typeof createRewardSchema>;
export type RewardUpdateInput = z.infer<typeof updateRewardSchema>;
```

## Alternatives Considered

### Alternative 1: Hard delete rewards instead of soft-delete/archive
- **Description**: `DELETE FROM rewards WHERE id = $1` when parent removes a reward
- **Pros**: Simpler schema (no `is_active`); fewer rows over time
- **Cons**: Breaks referential integrity with `reward_redemptions.reward_id`; loses point audit trail; can't restore
- **Rejection Reason**: ADR-0004's `reward_redemptions` FK requires `rewards` rows to persist; archiving preserves history.

### Alternative 2: Separate `reward_inventory_ledger` table instead of running counter
- **Description**: Append-only ledger of inventory mutations; derive `total_claimed` via `SUM()`
- **Pros**: Full audit trail of every reservation; no lost updates
- **Cons**: Extra join/aggregation on every catalog read; overkill for a single counter; SERIALIZABLE tx already gives correctness
- **Rejection Reason**: Atomic `UPDATE ... RETURNING` is simpler and correct under SERIALIZABLE isolation. A ledger can be added later if auditing needs grow.

### Alternative 3: Enforce weekly limit via a unique partial index instead of a COUNT query
- **Description**: Index `(child_id, reward_id, week)` and enforce a cap via constraint
- **Pros**: DB-enforced; no race possible
- **Cons**: PostgreSQL has no native "max N rows per group" constraint; would require a trigger or generated week-bucket table — heavy machinery for a small limit
- **Rejection Reason**: COUNT inside the SERIALIZABLE transaction (ADR-0003) is sufficient and far simpler.

## Consequences

### Positive
- Single source of truth for reward catalog, family-scoped (ADR-0006)
- Inventory never oversells: atomic `UPDATE ... RETURNING` under SERIALIZABLE isolation
- Weekly limit races prevented by checking inside the redemption transaction
- Soft-delete preserves historical redemptions and point audit trail
- `point_cost` snapshot (ADR-0004) decouples reward price edits from in-flight redemptions
- Parent can freely edit cost/tier/limits without affecting pending redemptions

### Negative
- Archived rewards remain in the table (minor storage cost)
- `total_claimed` is a denormalized counter; if a redemption is cancelled post-approval (not currently supported — ADR-0004 forbids `approved → rejected`), the counter would need a compensating decrement
- Weekly limit COUNT query runs on every redemption attempt (acceptable: indexed by `child_id, reward_id`)

### Risks
- **Risk**: Concurrent redemptions race the weekly limit check → **Mitigation**: Check runs inside SERIALIZABLE transaction (ADR-0003); retry on serialization failure
- **Risk**: Parent edits `total_inventory` below current `total_claimed` → **Mitigation**: DB CHECK constraint `total_claimed <= total_inventory` rejects the edit; API returns 409
- **Risk**: Parent archives a reward with pending redemptions, breaking child expectations → **Mitigation**: Archived rewards still process pending redemptions (ADR-0004); only NEW redemptions are blocked
- **Risk**: `total_claimed` drifts from actual `reward_redemptions` count due to a bug → **Mitigation**: Nightly reconciliation job (future) comparing `total_claimed` to `COUNT(reward_redemptions WHERE status IN ('approved','fulfilled'))`; log drift > 0

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.4 | 奖励分小/中大三档 (small/medium/large tier system) | `rewardTierEnum` + `tier` column |
| §3.4 | 家长创建/编辑/下架奖励 (parent CRUD) | Parent API endpoints + `is_active` archive |
| §3.4 | 兑换消耗积分 (point cost) | `point_cost` column; snapshot consumed by ADR-0004 |
| §3.4 | 每个奖励可设总库存 (total inventory) | `total_inventory` (nullable) + atomic decrement |
| §3.4 | 每孩每周兑换次数上限 (per-child weekly limit) | `weekly_limit_per_child` + COUNT check in SERIALIZABLE tx |
| §5.2 | rewards schema fields | All columns match DETAILED_DESIGN §11 |

## Performance Implications
- **CPU**: Negligible — CRUD is standard; atomic inventory UPDATE is a single indexed row write
- **Memory**: N/A
- **Load Time**: Catalog list is one indexed query on `(family_id, is_active)`; <5ms typical
- **Network**: N/A
- **Concurrency**: SERIALIZABLE isolation may trigger retries under high concurrency; family scale (~5 users) makes this near-zero probability

## Migration Plan
N/A — new codebase.

## Validation Criteria
- [ ] Parent can create a reward with all fields; Zod rejects invalid input (title >50, point_cost <1, etc.)
- [ ] Cross-family GET/PATCH/DELETE returns 404 (ADR-0006 test pattern)
- [ ] PATCH refuses to modify `total_claimed` (field absent from `updateRewardSchema`)
- [ ] Archive (DELETE) sets `is_active=false`; row remains in table
- [ ] Archived reward is hidden from child catalog endpoint
- [ ] Concurrent redemption attempts never exceed `total_inventory` (integration test with N parallel requests)
- [ ] Weekly limit exceeded returns 409 `{ code: 'weekly_limit_exceeded' }` and releases reserved inventory
- [ ] Editing `rewards.point_cost` does NOT change existing `reward_redemptions.point_cost` (snapshot integrity)
- [ ] DB CHECK rejects `total_inventory < total_claimed` edits with 409
- [ ] All TDD_SPEC reward management tests pass

## Related Decisions
- ADR-0003 (Points Integrity — provides the SERIALIZABLE transaction wrapper used for inventory + weekly limit)
- ADR-0004 (Redemption State Machine — depends on this ADR; `reward_redemptions.reward_id` FK targets `rewards.id`; `point_cost` snapshot sourced here)
- ADR-0006 (Multi-Tenant Isolation — `tenantScope(familyId)` repository pattern; 404 on cross-family access)
- ADR-0010 (Background Jobs — template structure followed)
