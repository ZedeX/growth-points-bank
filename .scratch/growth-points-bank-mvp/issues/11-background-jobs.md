# 11 — Background Jobs Scheduler

**What to build:** Wire `node-cron` in-process scheduler per ADR-0010 with 2 jobs: (1) Weekly review reminder every Sunday 18:00 UTC sending a notification to families who haven't started their review; (2) Daily fulfillment reminder at 09:00 UTC scanning `reward_redemptions` for `status='approved'` older than 7 days without `fulfilled_at`. After this ticket, families who haven't done their Sunday review get a nudge, and parents get reminded to fulfill overdue redemptions.

**Blocked by:** 09 — Weekly Review (need review status query), 07 — Rewards and Redemption Flow (need redemption records).

**Status:** ready-for-agent

- [ ] `src/server/jobs/scheduler.ts`: `startScheduler()` registers 2 cron jobs (Phase 2 daily check-in reminder is skipped per PRD)
- [ ] `src/server/jobs/weeklyReviewReminder.ts`: queries families where review for current week is null AND `last_reminder_sent_at` is older than 6 hours → sends notification → updates `last_reminder_sent_at`
- [ ] `src/server/jobs/fulfillmentReminder.ts`: queries `reward_redemptions` WHERE `status='approved' AND reviewed_at < NOW() - INTERVAL '7 days' AND fulfilled_at IS NULL` → notifies parent
- [ ] `src/server/utils/retry.ts` `withRetry(fn, maxRetries=3, baseBackoffMs=1000)` exponential backoff per ADR-0010
- [ ] Structured logging: each job run has `runId` (UUID), start/end timestamps, success/failure status
- [ ] Job failures logged at ERROR level with full stack trace + runId
- [ ] `ENABLE_SCHEDULER` env var: only starts if `'true'` (disabled on Vercel serverless, enabled on Railway worker)
- [ ] Scheduler does not block Fastify startup — runs in background after `app.listen` resolves
- [ ] `/api/health` reports `scheduler: { status: 'healthy', lastRunAt: '...' }`
- [ ] Job idempotency: re-running same job within same minute is a no-op (track `lastRunId` in memory)
- [ ] Unit tests: mock cron trigger → assert correct queries fired + correct notifications queued
- [ ] Integration tests: pre-seed family with no review + Sunday 18:00 trigger → notification recorded in `notifications` table
- [ ] Integration tests: pre-seed 8-day-old approved redemption → trigger job → parent receives reminder
