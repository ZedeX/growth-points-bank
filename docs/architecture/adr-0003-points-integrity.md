# ADR-0003: Points Transaction Integrity (Single-Source Balance via DB Transaction + CHECK)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | PostgreSQL 16 + Drizzle ORM |
| Domain | Data Integrity / Transactional Consistency |
| Knowledge Risk | LOW — SQL SERIALIZABLE + CHECK constraints are well-established |
| References Consulted | PRD §4.4 (积分系统), TDD_SPEC §7 (积分系统测试) |
| Post-Cutoff APIs Used | None |
| Verification Required | Concurrent check-in test with 2 simultaneous requests |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack) |
| Enables | ADR-0004 (Redemption State Machine — uses same transaction pattern) |
| Blocks | Epics "Daily Check-in", "Points System", "Reward Redemption" |
| Ordering Note | Must be Accepted before any check-in or redemption code |

## Context

### Problem Statement
Points are the core currency of the app. PRD §4.4 mandates:
- 积分来源：仅通过完成任务获得
- 积分消耗：仅通过兑换奖励消耗
- 积分不可手动调整
- 每条 PointTransaction records `balance_after` (operation后余额)

A naive implementation that reads balance, computes new balance, and writes back is vulnerable to **concurrent writes**: two parallel check-ins would both read balance=10, both compute balance=12, both write 12 → loses 2 points.

### Constraints
- One child may have multiple devices (phone + tablet) → real concurrent requests possible
- Parent revoking a check-in must deduct points atomically with the revocation
- Redemption approval must deduct points atomically with state transition
- `balance_after` must always equal the running sum (auditability requirement)
- No "manual adjustment" path (PRD: 积分不可手动调整)

### Requirements
- All point mutations are atomic (ACID)
- `balance_after` is always consistent with sum of all transactions
- No lost-update on concurrent check-ins
- Rollback on any failure (e.g., constraint violation)
- Performance: check-in completes < 500ms p95

## Decision

### Single Source of Truth: Derived Balance + Materialized Last Transaction

**Approach**: Store `balance_after` on each `point_transactions` row; derive current balance from `MAX(balance_after) WHERE child_id = ?`. Use `SERIALIZABLE` transaction isolation on inserts to prevent concurrent insert races.

```sql
-- Schema (already in PRD §5.2, restated with constraints)

CREATE TABLE point_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id        UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,  -- positive=earn, negative=spend
  source_type     TEXT NOT NULL CHECK (source_type IN ('task', 'reward', 'revocation')),
  source_id       UUID NOT NULL,
  balance_after   INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount <> 0)  -- amount must be non-zero
);

CREATE INDEX idx_point_tx_child_created ON point_transactions(child_id, created_at DESC);

-- Forbid duplicate point transactions for the same source
-- (prevents "check-in gives points twice" bug)
CREATE UNIQUE INDEX uq_point_tx_source ON point_transactions(source_type, source_id);
```

### Insert Pattern: SELECT-then-INSERT inside SERIALIZABLE

```typescript
// src/server/services/points.ts
import { sql } from 'drizzle-orm';

export async function recordPointsTx(
  db: DrizzleDB,
  childId: string,
  amount: number,
  sourceType: 'task' | 'reward' | 'revocation',
  sourceId: string,
): Promise<{ balance_after: number }> {
  return await db.transaction(async (tx) => {
    // Set isolation to SERIALIZABLE for this transaction
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

    // Read current balance (most recent row)
    const last = await tx.execute(sql`
      SELECT balance_after FROM point_transactions
      WHERE child_id = ${childId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE  -- row lock on the latest row
    `);

    const currentBalance = last.rows[0]?.balance_after ?? 0;
    const newBalance = currentBalance + amount;

    // CHECK constraint: balance cannot go negative (rejection of insufficient-points redemption)
    if (newBalance < 0) {
      throw new PointsError('INSUFFICIENT_BALANCE', `Need ${-amount}, have ${currentBalance}`);
    }

    // Insert the new transaction row
    const [row] = await tx.execute(sql`
      INSERT INTO point_transactions (child_id, amount, source_type, source_id, balance_after)
      VALUES (${childId}, ${amount}, ${sourceType}, ${sourceId}, ${newBalance})
      RETURNING balance_after
    `);

    return { balance_after: row.balance_after as number };
  });
}
```

### Why SERIALIZABLE?

- `READ COMMITTED` (default) allows two concurrent transactions to both read balance=10 and both insert balance=12 → lost update
- `REPEATABLE READ` in Postgres uses Snapshot Isolation, which would cause one tx to fail with `could not serialize access due to read/write dependencies` — better, but error handling is messy
- `SERIALIZABLE` is the simplest correctness guarantee; Postgres's SSI implementation handles the retry automatically (or we catch and retry)

### Concurrency Control: Retry on Serialization Failure

```typescript
const MAX_RETRIES = 3;

export async function withSerializableRetry<T>(
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (isSerializationError(err) && attempt < MAX_RETRIES) {
        attempt++;
        await sleep(50 * attempt);  // linear backoff
        continue;
      }
      throw err;
    }
  }
}
```

### Concurrent Check-In Test

The TDD_SPEC will include a test (slice 6.4) that fires 5 concurrent check-ins for **different tasks** of the same child; expectation: all 5 succeed, final balance = sum of 5 task values, no duplicates.

```typescript
test('concurrent check-ins for different tasks do not lose points', async () => {
  const { childToken, taskIds } = await setupChildWithFiveTasks();

  const results = await Promise.allSettled(
    taskIds.map(taskId =>
      request(app).post('/api/checkins')
        .set('Authorization', `Bearer ${childToken}`)
        .send({ task_id: taskId, date: '2026-07-15' })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled');
  expect(succeeded).toHaveLength(5);

  const balance = await getBalance(childToken);
  expect(balance).toBe(10);  // 5 tasks × 2 points each
});
```

### Audit Query

```sql
-- Verify integrity: balance_after must equal running sum
WITH running AS (
  SELECT child_id, balance_after,
    SUM(amount) OVER (PARTITION BY child_id ORDER BY created_at, id) AS expected
  FROM point_transactions
)
SELECT * FROM running WHERE balance_after <> expected;
-- Should always return 0 rows
```

## Alternatives Considered

### Alternative 1: Materialized `balance` column on `children` table
- **Description**: Store `balance INT` on children; update on each mutation
- **Pros**: O(1) read for current balance
- **Cons**: Dual source of truth (balance column vs. transaction history); risk of drift; harder to audit
- **Rejection Reason**: Single source of truth is more important than read performance; current balance can be derived in <1ms via index seek on `idx_point_tx_child_created`.

### Alternative 2: Redis atomic counter
- **Description**: Use Redis INCR/DECR for balance; reconcile to Postgres periodically
- **Pros**: Extremely fast; atomic
- **Cons**: Adds Redis dependency; reconciliation complexity; risk of drift on crash; overkill for MVP
- **Rejection Reason**: Postgres SERIALIZABLE is sufficient for this scale; no need for Redis.

### Alternative 3: Optimistic concurrency with version column
- **Description**: Add `version INT` to children; CAS update on each mutation
- **Pros**: No row-level locking; simpler than SERIALIZABLE
- **Cons**: Higher retry rate under contention; doesn't prevent duplicate point_transactions (need separate UNIQUE constraint anyway); doesn't help audit trail
- **Rejection Reason**: SERIALIZABLE + UNIQUE(source_type, source_id) is more robust.

## Consequences

### Positive
- Single source of truth (point_transactions table)
- `balance_after` is always consistent — auditors can verify via running sum
- SERIALIZABLE isolation = no lost updates, no phantoms
- UNIQUE(source_type, source_id) prevents duplicate crediting (e.g., retry-bug double credit)
- CHECK constraint (amount <> 0) prevents no-op transactions
- Drizzle transaction wrapper ensures rollback on any failure

### Negative
- SERIALIZABLE has higher overhead than READ COMMITTED (typically <5% for low-contention workloads)
- May see serialization failures under heavy contention → needs retry wrapper
- Each point mutation costs ~3 DB queries (SET ISOLATION + SELECT + INSERT)
- `balance_after` denormalization requires the SELECT-then-INSERT pattern (no pure single-INSERT)

### Risks
- **Risk**: Serialization failure storm under high concurrency → **Mitigation**: `withSerializableRetry` with linear backoff; for MVP scale (one family), contention is minimal
- **Risk**: Application bug creates duplicate point_transactions for one check-in → **Mitigation**: UNIQUE(source_type, source_id) constraint; check-in id used as source_id
- **Risk**: Long-running transaction holds locks → **Mitigation**: Keep transactions < 50ms; no external calls inside tx
- **Risk**: Migration drops CHECK constraints accidentally → **Mitigation**: Drizzle schema is source of truth; CI checks schema diff

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §4.4 | 积分来源：仅通过完成任务获得 | source_type CHECK limits to 'task'/'reward'/'revocation' |
| §4.4 | 积分不可手动调整 | No admin endpoint to write point_transactions directly |
| §4.4 | 操作后余额 | balance_after column on every row |
| §4.4 | 积分明细流水 (timestamp/source/amount/balance) | All columns present, indexed by child+time |
| TDD §6.1 RED 2 | 同日重复打卡被拒 | UNIQUE(source_type='task', source_id=checkin.id) prevents duplicate credit |

## Performance Implications
- **CPU**: SERIALIZABLE bookkeeping is minimal at family-scale; <1% CPU
- **Memory**: Connection holds row lock briefly; no caching
- **Load Time**: Balance query is indexed seek: <5ms
- **Network**: N/A

## Migration Plan
N/A — schema defined fresh via Drizzle migration `0001_init.sql`.

## Validation Criteria
- [ ] 5 concurrent check-ins for different tasks all succeed; final balance = sum
- [ ] 2 concurrent check-ins for the SAME task: exactly one succeeds, one fails with 409
- [ ] Audit query (running sum vs balance_after) returns 0 mismatches after 1000 random operations
- [ ] Redeem with insufficient balance: 400 error, no row inserted, balance unchanged
- [ ] All TDD_SPEC §7 tests pass

## Related Decisions
- ADR-0001 (Tech Stack — provides Postgres + Drizzle)
- ADR-0004 (Redemption State Machine — uses recordPointsTx for redemption approval)
- ADR-0006 (Multi-tenant Isolation — every query filters by family_id)
