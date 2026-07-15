# 09 — Weekly Review (Double-Blind)

**What to build:** The Sunday-evening family review flow per PRD §3.3 with strict double-blind visibility: child and parent can fill their respective sections independently. Until both have committed, neither sees the other's content. Once both commit, the review locks and aggregates weekly stats (task count, points earned, dimensions lit). After this ticket, a family can complete a Sunday-night review that locks the record forever.

**Blocked by:** 06 — Daily Check-In and Points Ledger (needs aggregated stats source).

**Status:** ready-for-agent

- [ ] `src/shared/domain/reviews.ts` pure functions: `getReviewVisibility(review, viewerRole)` returning `{ best_thing, difficulty, parent_observation, child_request, other_status, locked }`
- [ ] `other_status` enum: `'other_not_started' | 'other_committed' | 'locked'`
- [ ] `src/server/routes/reviews.ts`: `GET /api/reviews?week=YYYY-MM-DD`, `POST /api/reviews/child` (upsert), `POST /api/reviews/parent` (upsert), `GET /api/reviews/history`
- [ ] `POST /api/reviews/parent` requires `child_id` in body (parent picks which child)
- [ ] DB CHECK constraint `wr_commit_state_valid` from `DETAILED_DESIGN.md §5.1` enforces commit-state invariants
- [ ] DB trigger `auto_lock_weekly_review()` from `DETAILED_DESIGN.md §5.3` sets `locked_at` when both committed
- [ ] UNIQUE INDEX `uq_weekly_review_per_week ON weekly_reviews(child_id, week_start_date)` enforces one-review-per-week
- [ ] Aggregation on lock: compute `task_count`, `point_earned`, `dimension_count` from `checkins` + `point_transactions` for the week Monday 00:00 → Sunday 23:59 UTC
- [ ] Once `locked_at IS NOT NULL`, both `POST /api/reviews/child` and `POST /api/reviews/parent` return 409 `REVIEW_LOCKED`
- [ ] `GET /api/reviews?week=` returns own content always; other's content only if other has committed; both content if locked
- [ ] All unit tests from `TDD_SPEC.md §13.1` pass (3 visibility cases)
- [ ] All integration tests from `TDD_SPEC.md §13.2` pass (child submit, locked rejection, auto-lock on both-commit, parent→child visibility, upsert same week)
- [ ] Aggregation test `TDD_SPEC.md §13.3` RED 1: pre-seeded week activity → lock → aggregates correct
