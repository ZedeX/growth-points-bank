# ADR-0004: Reward Redemption State Machine

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | PostgreSQL 16 + Drizzle ORM + Zod |
| Domain | Domain Logic / State Machine |
| Knowledge Risk | LOW — state machine pattern is foundational |
| References Consulted | PRD §3.4 (奖励兑换), TDD_SPEC §8 |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0003 (Points Integrity) |
| Enables | Epic "Reward Redemption" |
| Blocks | None (downstream of ADR-0003) |
| Ordering Note | Must be Accepted before check-in or redemption endpoints |

## Context

### Problem Statement
PRD §3.4 defines a 4-state lifecycle for reward redemptions:

```
pending → approved → fulfilled
   │
   └──→ rejected
```

Each transition has side effects:
- `pending → approved`: deduct points (via ADR-0003)
- `pending → rejected`: no points change
- `approved → fulfilled`: no points change (already deducted at approval)
- `approved → rejected` is FORBIDDEN (PRD: cannot reverse an approval — points already deducted, would require refund logic)
- `rejected → anything` is FORBIDDEN
- `fulfilled → anything` is FORBIDDEN

The state machine must be enforced at the **database level**, not just in application code, to prevent bugs (e.g., a script accidentally approving a rejected redemption).

### Constraints
- 7-day fulfillment reminder (PRD §3.4: 超过7天未标记兑现，系统提醒家长)
- `point_cost` is snapshotted at request time (PRD §5.2: 消耗积分（快照）) — protects against later reward price changes
- State transitions must be atomic with point mutations (ADR-0003)
- Status field is enum (PRD §5.2)

### Requirements
- Invalid transitions return 400 with descriptive error
- All valid transitions are atomic (state + point mutation in same DB transaction)
- `point_cost` snapshot is immutable once created
- `reviewed_at` set on first transition out of `pending`
- `fulfilled_at` set on `→ fulfilled`

## Decision

### State Machine Definition

```typescript
// packages/shared/redemption-state-machine.ts

export const RedemptionStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FULFILLED: 'fulfilled',
} as const;

export type RedemptionStatus = typeof RedemptionStatus[keyof typeof RedemptionStatus];

/**
 * Allowed transitions: fromStatus → Set<toStatus>
 * Any transition not in this map is forbidden.
 */
export const REDEMPTION_TRANSITIONS: Record<RedemptionStatus, Set<RedemptionStatus>> = {
  pending:  new Set(['approved', 'rejected']),
  approved: new Set(['fulfilled']),
  rejected: new Set(),  // terminal
  fulfilled: new Set(),  // terminal
};

export function canTransition(from: RedemptionStatus, to: RedemptionStatus): boolean {
  return REDEMPTION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertCanTransition(from: RedemptionStatus, to: RedemptionStatus): void {
  if (!canTransition(from, to)) {
    throw new RedemptionTransitionError(from, to);
  }
}
```

### Database-Level Enforcement (Belt and Suspenders)

```sql
-- Add CHECK constraint on transitions
ALTER TABLE reward_redemptions ADD CONSTRAINT valid_redemption_transition
CHECK (
  status = 'pending' OR
  (status = 'approved' AND reviewed_at IS NOT NULL) OR
  (status = 'rejected' AND reviewed_at IS NOT NULL) OR
  (status = 'fulfilled' AND reviewed_at IS NOT NULL AND fulfilled_at IS NOT NULL)
);

-- Trigger to enforce transition validity
CREATE OR REPLACE FUNCTION enforce_redemption_transition() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;  -- no transition, allow (e.g., UPDATE on parent_note)
  END IF;

  IF (
    (OLD.status = 'pending'  AND NEW.status NOT IN ('approved', 'rejected')) OR
    (OLD.status = 'approved' AND NEW.status <> 'fulfilled') OR
    (OLD.status = 'rejected' AND TRUE) OR  -- terminal, no transitions
    (OLD.status = 'fulfilled' AND TRUE)    -- terminal, no transitions
  ) THEN
    RAISE EXCEPTION 'Invalid redemption transition: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redemption_transition_guard
BEFORE UPDATE OF status ON reward_redemptions
FOR EACH ROW EXECUTE FUNCTION enforce_redemption_transition();
```

### Application-Layer Transition Service

```typescript
// src/server/services/redemption.ts

export async function approveRedemption(
  redemptionId: string,
  parentNote: string | null,
): Promise<{ status: 'approved'; balance_after: number }> {
  return await withSerializableRetry(() =>
    db.transaction(async (tx) => {
      const [redemption] = await tx.execute(sql`
        SELECT * FROM reward_redemptions WHERE id = ${redemptionId} FOR UPDATE
      `);

      if (!redemption) throw new NotFoundError('Redemption');
      assertCanTransition(redemption.status, 'approved');

      // Update redemption
      await tx.execute(sql`
        UPDATE reward_redemptions
        SET status = 'approved',
            reviewed_at = now(),
            parent_note = COALESCE(${parentNote}, parent_note)
        WHERE id = ${redemptionId}
      `);

      // Deduct points (uses ADR-0003 pattern)
      const { balance_after } = await recordPointsTx(
        tx, redemption.child_id, -redemption.point_cost, 'reward', redemption.id
      );

      return { status: 'approved' as const, balance_after };
    })
  );
}

export async function rejectRedemption(redemptionId: string, parentNote: string): Promise<{ status: 'rejected' }> {
  return await withSerializableRetry(() =>
    db.transaction(async (tx) => {
      const [redemption] = await tx.execute(sql`
        SELECT * FROM reward_redemptions WHERE id = ${redemptionId} FOR UPDATE
      `);

      if (!redemption) throw new NotFoundError('Redemption');
      assertCanTransition(redemption.status, 'rejected');

      await tx.execute(sql`
        UPDATE reward_redemptions
        SET status = 'rejected',
            reviewed_at = now(),
            parent_note = ${parentNote}
        WHERE id = ${redemptionId}
      `);

      // No point mutation — points were never deducted at pending stage
      return { status: 'rejected' as const };
    })
  );
}

export async function fulfillRedemption(redemptionId: string): Promise<{ status: 'fulfilled' }> {
  return await db.transaction(async (tx) => {
    const [redemption] = await tx.execute(sql`
      SELECT * FROM reward_redemptions WHERE id = ${redemptionId} FOR UPDATE
    `);

    if (!redemption) throw new NotFoundError('Redemption');
    assertCanTransition(redemption.status, 'fulfilled');

    await tx.execute(sql`
      UPDATE reward_redemptions
      SET status = 'fulfilled', fulfilled_at = now()
      WHERE id = ${redemptionId}
    `);

    return { status: 'fulfilled' as const };
  });
}
```

### 7-Day Fulfillment Reminder Cron

```typescript
// src/server/jobs/fulfillment-reminder.ts
import cron from 'node-cron';

// Daily at 09:00 Asia/Shanghai
cron.schedule('0 9 * * *', async () => {
  const stale = await db.execute(sql`
    SELECT id, child_id, reward_id, point_cost, reviewed_at
    FROM reward_redemptions
    WHERE status = 'approved'
      AND reviewed_at < now() - INTERVAL '7 days'
      AND fulfilled_at IS NULL
      AND last_reminder_sent_at < now() - INTERVAL '1 day'  -- don't spam
  `);

  for (const row of stale.rows) {
    await sendFulfillmentReminderNotification(row);
    await db.execute(sql`
      UPDATE reward_redemptions
      SET last_reminder_sent_at = now()
      WHERE id = ${row.id}
    `);
  }
}, { timezone: 'Asia/Shanghai' });
```

### Schema Additions

```sql
ALTER TABLE reward_redemptions ADD COLUMN last_reminder_sent_at TIMESTAMPTZ;
CREATE INDEX idx_redemptions_stale_fulfillment
  ON reward_redemptions(reviewed_at)
  WHERE status = 'approved' AND fulfilled_at IS NULL;
```

## Alternatives Considered

### Alternative 1: Application-only enforcement (no DB trigger)
- **Description**: Validate transitions in TypeScript only
- **Pros**: Simpler schema; no triggers
- **Cons**: A bug or admin script could bypass; data corruption possible
- **Rejection Reason**: Defense in depth — DB trigger catches application bugs.

### Alternative 2: Use a state-machine library (e.g., `xstate`)
- **Description**: Model the state machine in XState
- **Pros**: Visual editor; explicit states/transitions
- **Cons**: Adds runtime dependency; overkill for 4 states; doesn't enforce at DB level
- **Rejection Reason**: A simple `Record<Status, Set<Status>>` map is sufficient and DB-level enforcement handles persistence.

### Alternative 3: Pre-deduct points at `pending` (instead of at `approved`)
- **Description**: Hold points in escrow at request time
- **Pros**: Child can't request multiple redemptions exceeding balance while pending
- **Cons**: PRD §3.4 example shows: `pending → balance still 50, approved → balance 20`. Explicitly post-deduct.
- **Rejection Reason**: Direct PRD violation; would require refund-on-reject logic.

## Consequences

### Positive
- State machine enforced at both app (TypeScript) and DB (trigger) levels
- Transitions atomic with point mutations via ADR-0003
- `point_cost` snapshot protects against reward price changes mid-flight
- 7-day reminder is cron-based, no queue infrastructure needed
- Terminal states (`rejected`, `fulfilled`) are truly terminal at DB level

### Negative
- DB trigger adds complexity to schema; migration reversals need careful handling
- `last_reminder_sent_at` column needs management
- Cron-based reminders can be delayed if backend restarts at 09:00

### Risks
- **Risk**: Trigger prevents legitimate admin repair (e.g., undoing a mistakenly approved redemption) → **Mitigation**: If admin repair is needed, write a one-time SQL script that drops the trigger, performs the fix, and recreates it (documented in `docs/runbooks/`)
- **Risk**: Cron job fails silently → **Mitigation**: Log to stdout (Railway captures), add `last_reminder_sent_at` tracking, alert on stale count > threshold
- **Risk**: Concurrent `approve` and `reject` calls race → **Mitigation**: `SELECT ... FOR UPDATE` row lock inside transaction; only one will succeed

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.4 | pending(待审核) → approved(已通过/待履约) → fulfilled(已兑现) | State machine transitions |
| §3.4 | rejected(已拒绝) | Terminal state in state machine |
| §3.4 | 通过 → 扣除相应积分 | `approveRedemption` calls `recordPointsTx(-point_cost)` |
| §3.4 | 拒绝 → 积分不扣除 | `rejectRedemption` performs no point mutation |
| §3.4 | 不能对已拒绝的兑换进行通过 | `REDEMPTION_TRANSITIONS['rejected'] = new Set()` |
| §3.4 | 超过7天未标记兑现，系统提醒家长 | Cron job at 09:00 daily |
| §5.2 | point_cost (消耗积分快照) | `point_cost` column is set at INSERT, never updated |

## Performance Implications
- **CPU**: Trigger adds ~0.1ms per UPDATE; negligible
- **Memory**: N/A
- **Load Time**: N/A
- **Network**: N/A

## Migration Plan
N/A — schema is new.

## Validation Criteria
- [ ] All 4 valid transitions succeed
- [ ] All 6 invalid transitions (e.g., `rejected → approved`) fail with 400
- [ ] `approveRedemption` deducts points atomically (rollback if point mutation fails)
- [ ] `rejectRedemption` performs no point mutation
- [ ] 7-day reminder fires for stale `approved` redemptions
- [ ] All TDD_SPEC §8 tests pass

## Related Decisions
- ADR-0003 (Points Integrity — `recordPointsTx` is reused)
- ADR-0010 (Background Jobs — cron pattern)
