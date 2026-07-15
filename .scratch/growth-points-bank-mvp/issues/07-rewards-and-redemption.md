# 07 — Rewards and Redemption Flow

**What to build:** A parent can configure rewards across 3 tiers (small/medium/large). A child can browse rewards, request a redemption (with child_note), and a parent can approve/reject with parent_note. Approve atomically deducts points; reject leaves balance untouched. Approved redemptions can be marked fulfilled. State machine enforces only valid transitions per ADR-0004.

**Blocked by:** 06 — Daily Check-In and Points Ledger (redemption approve must write to point_transactions).

**Status:** ready-for-agent

- [ ] `src/shared/domain/rewards.ts`: `REDEMPTION_TRANSITIONS` map, `canTransition(from, to)`, `canRedeem(balance, reward)` returning `{ ok, shortfall? }`
- [ ] `src/server/services/RedemptionService.ts`: `create`, `approve` (SERIALIZABLE + FOR UPDATE + balance check + atomic deduction), `reject`, `fulfill`
- [ ] `src/server/routes/rewards.ts`: `POST/GET/PUT/DELETE /api/rewards` (parent only)
- [ ] `src/server/routes/redemptions.ts`: `POST /api/redemptions` (child or parent), `GET /api/redemptions` (child sees own; parent sees family), `PATCH /api/redemptions/:id/approve` (parent only), `PATCH /api/redemptions/:id/reject`, `PATCH /api/redemptions/:id/fulfill`
- [ ] DB trigger `enforce_redemption_transition()` from `DETAILED_DESIGN.md §5.3` blocks illegal transitions at DB layer
- [ ] Approve flow: SELECT FOR UPDATE redemption → check balance → INSERT point_transactions (negative) → UPDATE redemption.status='approved' → COMMIT
- [ ] Insufficient balance → `INSUFFICIENT_BALANCE` 422 with `{ balance, required, shortfall }` details
- [ ] All tests from `TDD_SPEC.md §8` pass (create redemption, approve deducts points, reject no deduction, fulfill updates status)
- [ ] Concurrency test `TDD_SPEC.md §15.2` RED 3: concurrent approvals when balance covers only one → one success + one 422
- [ ] Error flow tests `TDD_SPEC.md §17.2` RED 7: invalid transition returns 409 CONFLICT
- [ ] Multi-tenant test `TDD_SPEC.md §16.1` RED 3: cross-family redemption access returns 404
