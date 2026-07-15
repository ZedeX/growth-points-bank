# 06 — Daily Check-In and Points Ledger

**What to build:** A child (or parent on their behalf) can check in a task for today, which atomically writes a `checkins` row and a `point_transactions` row with derived `balance_after`. Revoking a checkin (by parent) writes a negative `point_transactions` entry with `source_type='revocation'`. All write paths use SERIALIZABLE isolation with retry per ADR-0003. After this ticket, the points ledger is the single source of truth for balance.

**Blocked by:** 05 — Tasks Management (needs task visibility rules for validation).

**Status:** ready-for-agent

- [ ] `src/server/services/CheckInService.ts`: `create(childId, taskId, date)`, `revoke(checkinId, parentToken)`, `getToday(childId)`
- [ ] `src/server/services/PointsService.ts`: `recordTransaction(tx, childId, amount, sourceType, sourceId)`, `getBalance(childId)` via `SELECT balance_after ... ORDER BY created_at DESC LIMIT 1`
- [ ] `src/server/utils/retry.ts`: `withSerializableRetry(fn, maxRetries=3, baseBackoffMs=50)` per `DETAILED_DESIGN.md §4.4`
- [ ] `src/server/routes/checkins.ts`: `POST /api/checkins`, `DELETE /api/checkins/:id`, `GET /api/checkins/today`, `POST /api/checkins/:id/revoke`
- [ ] `src/server/routes/points.ts`: `GET /api/points/balance`, `GET /api/points/transactions` (cursor pagination)
- [ ] Validation: task is active, task is visible today, no existing active checkin for same (child, task, date)
- [ ] Cannot check in for past date (date < today UTC)
- [ ] Revocation writes negative transaction with `source_type='revocation'`, `source_id=checkin.id`, and updates `checkins.revoked_by_parent=true`
- [ ] All tests from `TDD_SPEC.md §6` pass (child check-in, parent revoke, balance update, today list)
- [ ] All tests from `TDD_SPEC.md §7` pass (balance derivation, transaction history, revocation reflects)
- [ ] Concurrency tests from `TDD_SPEC.md §15.1` pass (concurrent same-task → only one succeeds, concurrent different-tasks → correct sum)
- [ ] SERIALIZABLE retry test: mock serialization_failure → retried → success (or 503 after 3 attempts)
- [ ] DB UNIQUE INDEX `uq_checkin_active ON checkins(child_id, task_id, date) WHERE revoked_by_parent = false` enforced
- [ ] DB UNIQUE INDEX `uq_point_transaction_source ON point_transactions(child_id, source_type, source_id)` enforced
