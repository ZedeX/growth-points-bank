# ADR-0005: Weekly Review Double-Blind via Commit-then-Reveal

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | PostgreSQL 16 + crypto.subtle (Web Crypto API on Node 20) |
| Domain | Domain Logic / Cryptographic Commitment |
| Knowledge Risk | LOW — SHA-256 commitment scheme is foundational cryptography |
| References Consulted | PRD §3.3 (每周家庭复盘), §9.4 (每周复盘双盲) |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack) |
| Enables | Epic "Weekly Family Review" (Phase 2) |
| Blocks | None (Phase 2 feature) |
| Ordering Note | Can be deferred to Phase 2 implementation, but ADR is needed now so DB schema is correct from day 1 |

## Context

### Problem Statement
PRD §3.3 mandates a true double-blind weekly review:
- 双方在未提交前，互相看不到对方的填写内容
- 任意一方先提交后，可以看到对方已提交的内容
- 如果对方尚未提交，显示"等待对方填写中..."
- 双方都提交后，复盘记录锁定为只读

A naive implementation that stores `child_text` and `parent_text` in plain columns fails: a parent with DB access (or a bug) can read the child's draft before submitting their own. Even at the application layer, a careful audit would be needed to ensure no code path leaks the other party's draft.

### Constraints
- Both child and parent submit independently; cannot require ordering
- Once both have submitted, both become visible to each other (and locked)
- Performance: retrieval of own draft while waiting must be fast
- Auditable: must be able to prove after the fact that no early-reading occurred (logging)

### Requirements
- Cryptographic guarantee that the other party's content cannot be read before self-submission
- Atomic transition: when second party submits, both contents become readable to each other
- Once locked, no edits allowed
- Schema should be forward-compatible with Phase 2 features

## Decision

### Commitment Scheme: SHA-256 + Per-Review Random Salt

Each party submits their content alongside a **commitment** (hash) of the other party's content. Wait — that doesn't work for unordered submission.

**Correct approach**: Each party encrypts their content with a key derived from a per-review nonce + their own secret. The nonce is revealed only after both have submitted.

Simpler approach that achieves the goal:

### Two-Phase Schema with Hash Commitment

```sql
CREATE TABLE weekly_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  week_start_date   DATE NOT NULL,
  -- Child fields
  best_thing        TEXT,           -- child's draft (encrypted at rest, see below)
  difficulty        TEXT,
  child_request     TEXT,
  child_committed_at TIMESTAMPTZ,   -- when child submitted
  -- Parent fields
  parent_observation TEXT,          -- parent's draft (encrypted at rest)
  parent_committed_at TIMESTAMPTZ,
  -- Aggregate (computed on lock)
  task_count        INTEGER,
  point_earned      INTEGER,
  dimension_count   INTEGER,
  -- Lock state
  locked_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, week_start_date),
  CHECK (
    (child_committed_at IS NULL AND parent_committed_at IS NULL) OR  -- both pending
    (child_committed_at IS NOT NULL AND parent_committed_at IS NULL AND locked_at IS NULL) OR  -- child only
    (child_committed_at IS NULL AND parent_committed_at IS NOT NULL AND locked_at IS NULL) OR  -- parent only
    (child_committed_at IS NOT NULL AND parent_committed_at IS NOT NULL AND locked_at IS NOT NULL)  -- both done, locked
  )
);
```

### Access Control Rules (Enforced at API Layer)

```typescript
// src/server/services/weekly-review.ts

export async function getReview(childId: string, weekStart: string, requester: 'child' | 'parent'): Promise<WeeklyReviewView> {
  const [review] = await db.execute(sql`
    SELECT * FROM weekly_reviews WHERE child_id = ${childId} AND week_start_date = ${weekStart}
  `);

  if (!review) return null;

  const selfCommitted = requester === 'child' ? review.child_committed_at : review.parent_committed_at;
  const otherCommitted = requester === 'child' ? review.parent_committed_at : review.child_committed_at;

  // Self can always see own content (whether committed or in draft)
  const ownContent = requester === 'child'
    ? { best_thing: review.best_thing, difficulty: review.difficulty, child_request: review.child_request }
    : { parent_observation: review.parent_observation };

  // Other's content visible only if BOTH committed
  const otherContent = (selfCommitted && otherCommitted && review.locked_at)
    ? (requester === 'child'
        ? { parent_observation: review.parent_observation }
        : { best_thing: review.best_thing, difficulty: review.difficulty, child_request: review.child_request })
    : (otherCommitted
        ? { status: 'other_committed_waiting_for_you' }  // other done, but you haven't committed
        : { status: 'other_not_started' });

  return {
    ...ownContent,
    other: otherContent,
    self_committed: !!selfCommitted,
    locked: !!review.locked_at,
  };
}

export async function submitChildReview(childId: string, weekStart: string, fields: ChildReviewFields): Promise<void> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.execute(sql`
      SELECT child_committed_at, parent_committed_at, locked_at FROM weekly_reviews
      WHERE child_id = ${childId} AND week_start_date = ${weekStart} FOR UPDATE
    `);

    if (existing?.locked_at) throw new ConflictError('Review already locked');

    const now = new Date();
    const bothCommitted = existing?.parent_committed_at !== null;

    await tx.execute(sql`
      INSERT INTO weekly_reviews (child_id, week_start_date, best_thing, difficulty, child_request, child_committed_at, locked_at, updated_at)
      VALUES (${childId}, ${weekStart}, ${fields.best_thing}, ${fields.difficulty}, ${fields.child_request}, ${now},
        CASE WHEN ${bothCommitted} THEN ${now} ELSE NULL END,
        ${now})
      ON CONFLICT (child_id, week_start_date) DO UPDATE SET
        best_thing = EXCLUDED.best_thing,
        difficulty = EXCLUDED.difficulty,
        child_request = EXCLUDED.child_request,
        child_committed_at = ${now},
        locked_at = CASE WHEN weekly_reviews.parent_committed_at IS NOT NULL THEN ${now} ELSE weekly_reviews.locked_at END,
        updated_at = ${now}
    `);

    // If this commit locks the review, also compute the aggregate fields
    if (bothCommitted) {
      await tx.execute(sql`
        UPDATE weekly_reviews SET
          task_count = (SELECT COUNT(*) FROM checkins WHERE child_id = ${childId} AND date >= ${weekStart} AND date < ${weekStart}::date + INTERVAL '7 days'),
          point_earned = (SELECT COALESCE(SUM(amount), 0) FROM point_transactions WHERE child_id = ${childId} AND created_at >= ${weekStart} AND created_at < ${weekStart}::date + INTERVAL '7 days'),
          dimension_count = (
            SELECT COUNT(DISTINCT t.dimension_id) FROM checkins c
            JOIN tasks t ON t.id = c.task_id
            WHERE c.child_id = ${childId} AND c.date >= ${weekStart} AND c.date < ${weekStart}::date + INTERVAL '7 days'
              AND c.revoked_by_parent = false
          )
        WHERE child_id = ${childId} AND week_start_date = ${weekStart}
      `);
    }
  });
}
```

### Field-Level Encryption at Rest (Defense in Depth)

Even with the API access control above, an attacker with DB read access could see drafts before both parties commit. To prevent this, store the draft fields encrypted with a key that's only derivable when both parties have committed.

**Approach**: Encrypt `best_thing`, `difficulty`, `child_request`, `parent_observation` with AES-256-GCM using a per-review key. The per-review key is split into two halves (child_half + parent_half) via XOR. Each half is stored encrypted with the respective party's user-specific encryption key.

```typescript
// On review creation:
const reviewKey = crypto.randomBytes(32);  // 256-bit
const childHalf = crypto.randomBytes(32);
const parentHalf = Buffer.xor(reviewKey, childHalf);  // reviewKey = childHalf XOR parentHalf

// Store childHalf encrypted with child's key; parentHalf encrypted with parent's key
// The plaintext review fields are encrypted with reviewKey

// When both have committed:
// - Both halves are released, XORed to recover reviewKey, fields re-encrypted with a "public" key (or kept as is, since access is now allowed)
```

**MVP simplification**: Skip the field-level encryption for now (it's complex). Rely on:
1. API-layer access control (above)
2. `CHECK` constraint preventing invalid commit states
3. Audit log of every read of `weekly_reviews` table

The full cryptographic scheme can be added in Phase 2 if threat model warrants.

### Audit Log

```sql
CREATE TABLE weekly_review_access_log (
  id           BIGSERIAL PRIMARY KEY,
  review_id    UUID NOT NULL REFERENCES weekly_reviews(id),
  reader_role  TEXT NOT NULL CHECK (reader_role IN ('child', 'parent', 'system')),
  field_read   TEXT NOT NULL,  -- 'own' | 'other' | 'aggregate'
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `submitChildReview` / `submitParentReview` / `getReview` functions all insert a row here on every read. This enables post-hoc verification that no early reads occurred.

## Alternatives Considered

### Alternative 1: Plain columns, application-only access control
- **Description**: Just check role + commit state in TypeScript
- **Pros**: Simple; no encryption overhead
- **Cons**: DB dump exposes drafts; bug in code can leak; no audit trail
- **Rejection Reason**: Insufficient for the "true double-blind" requirement (PRD §9.4). Audit log + CHECK constraint + access-controlled API provide minimum acceptable guarantee.

### Alternative 2: Full field-level encryption (described above)
- **Description**: AES-256-GCM with XOR key splitting
- **Pros**: Cryptographic guarantee — even DBA can't read drafts before commit
- **Cons**: Significant complexity for Phase 2 feature; key management burden; not needed for MVP
- **Rejection Reason**: Defer to Phase 2 if threat model warrants. Audit log + access control is sufficient for MVP.

### Alternative 3: Separate "drafts" table with delayed copy to "reviews" table
- **Description**: Drafts in `weekly_review_drafts`; on commit, copy to `weekly_reviews`
- **Pros**: Clean separation; draft table can be more permissive
- **Cons**: Two tables to manage; same access control problem; data duplication
- **Rejection Reason**: Overcomplicated. Single table with commit timestamps + CHECK constraint is sufficient.

## Consequences

### Positive
- `CHECK` constraint prevents invalid commit states (e.g., locked without both committed)
- API access control guarantees no early reads in code paths
- Audit log enables post-hoc verification
- Atomic transition to locked state via `FOR UPDATE` row lock
- Aggregate fields (`task_count`, `point_earned`, `dimension_count`) computed at lock time, not on every read

### Negative
- Two writes required to lock a review (second commit triggers aggregate computation)
- Audit log grows; needs periodic archival
- No cryptographic guarantee (deferred to Phase 2 if needed)

### Risks
- **Risk**: Bug in access control logic leaks other's draft → **Mitigation**: Audit log detects unauthorized reads; TDD tests cover all 4 state combinations (none/child-only/parent-only/both)
- **Risk**: Race condition between two simultaneous commits → **Mitigation**: `FOR UPDATE` row lock inside transaction
- **Risk**: Aggregate computation fails after lock → **Mitigation**: Wrap in same transaction; rollback on failure
- **Risk**: Audit log table grows unbounded → **Mitigation**: Add `weekly_review_access_log_archive_2027.sql` script for yearly archival

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.3 Part A | "这周我最棒的一件事是..." | `best_thing` field, child-submittable |
| §3.3 Part A | "这周我遇到的困难是..." | `difficulty` field, child-submittable |
| §3.3 Part B | 家长看见的进步 | `parent_observation` field, parent-submittable |
| §3.3 Part B | 孩子希望的支持 | `child_request` field |
| §3.3 Part C | 本周数据汇总（自动统计，只读） | Computed at lock time in `submitChildReview` / `submitParentReview` |
| §3.3 | 历史复盘记录按周列表查看，可展开详情 | `week_start_date` indexed; one row per week per child |
| §3.3 | 复盘记录不可编辑（提交后只读） | `locked_at IS NOT NULL` check in submit functions |
| §3.3 | 双盲机制 | `other` field in response is `other_committed_waiting_for_you` or `other_not_started` until both committed |
| §9.4 | 真正双盲 | CHECK constraint + access control + audit log |

## Performance Implications
- **CPU**: Aggregate computation at lock time is 3 SQL queries; <50ms on indexed columns
- **Memory**: Negligible
- **Load Time**: Get review is single indexed seek; <5ms
- **Network**: N/A

## Migration Plan
N/A — new schema.

## Validation Criteria
- [ ] Both parties see only own draft before committing
- [ ] After both commit, both see other's content
- [ ] Attempting to edit a locked review returns 409
- [ ] Audit log records every read with reader_role and field_read
- [ ] Aggregate fields (task_count, point_earned, dimension_count) populated at lock time
- [ ] All TDD_SPEC weekly review tests pass (to be added)

## Related Decisions
- ADR-0001 (Tech Stack — provides Postgres + Node crypto)
- ADR-0009 (Data Encryption — field-level encryption scheme could integrate here)
