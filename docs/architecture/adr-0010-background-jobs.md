# ADR-0010: Background Jobs (node-cron on Backend, No External Queue)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + `node-cron` 3.x |
| Domain | Scheduling / Background Tasks |
| Knowledge Risk | LOW — `node-cron` is mature and simple |
| References Consulted | PRD §3.3 (周日复盘提醒), §3.4 (履约追踪7天提醒), §4.4 (任务重置) |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0008 (Deployment — Railway runs backend) |
| Enables | Epics "Weekly Review", "Reward Redemption" |
| Blocks | None |
| Ordering Note | Add scheduler before Phase 2 features |

## Context

### Problem Statement
The app has three recurring background tasks:

1. **Daily task reset** (PRD §3.1: 每日 00:00 重置当日任务完成状态)
   - Note: Reset is implicit — no DB write needed. `CheckIn` rows are dated; "today" changes at midnight.
   - **Actual cron work**: Send daily reminder push to children who haven't checked in by 18:00 (Phase 2)

2. **Weekly reset** (PRD §3.2: 每周任务每周一 00:00 重置)
   - Implicit like above; no cron job needed for the reset itself.
   - **Actual cron work**: Sunday 18:00 weekly review reminder (PRD §3.3)

3. **Fulfillment reminder** (PRD §3.4: 超过7天未标记兑现，系统提醒家长)
   - Daily check at 09:00 for `approved` redemptions past 7 days

### Constraints
- Backend runs on Railway as a long-lived process (not serverless) — `node-cron` works
- No need for distributed locking (single instance)
- Timezone: Asia/Shanghai (`Asia/Shanghai`)
- Jobs must be idempotent (re-running is safe)
- Jobs must be observable (log output for debugging)

### Requirements
- Sunday 18:00 Asia/Shanghai: notify families to do weekly review
- Daily 09:00 Asia/Shanghai: send fulfillment reminder for stale `approved` redemptions
- Daily 18:00 Asia/Shanghai: (Phase 2) remind children to check in if they haven't
- All jobs logged with start/end/duration/result
- Jobs retry on transient failure (e.g., DB connection blip)

## Decision

### Use `node-cron` In-Process

```typescript
// src/server/jobs/scheduler.ts
import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { sendWeeklyReviewReminders } from './weekly-review-reminder.js';
import { sendFulfillmentReminders } from './fulfillment-reminder.js';
import { sendDailyCheckInReminders } from './daily-checkin-reminder.js';

export function startScheduler() {
  // Sunday 18:00 Asia/Shanghai = Sunday 10:00 UTC
  cron.schedule('0 18 * * 0', () => runJob('weekly-review-reminder', sendWeeklyReviewReminders), {
    timezone: 'Asia/Shanghai',
  });

  // Daily 09:00 Asia/Shanghai = Daily 01:00 UTC
  cron.schedule('0 9 * * *', () => runJob('fulfillment-reminder', sendFulfillmentReminders), {
    timezone: 'Asia/Shanghai',
  });

  // Daily 18:00 Asia/Shanghai (Phase 2)
  // cron.schedule('0 18 * * *', () => runJob('daily-checkin-reminder', sendDailyCheckInReminders), {
  //   timezone: 'Asia/Shanghai',
  // });

  logger.info('Scheduler started: 3 jobs registered');
}

async function runJob(name: string, fn: () => Promise<JobResult>): Promise<void> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  logger.info({ job: name, runId, status: 'started' }, 'Job started');

  try {
    const result = await withRetry(fn, { retries: 3, backoffMs: 1000 });
    const durationMs = Date.now() - start;
    logger.info({ job: name, runId, status: 'success', durationMs, result }, 'Job completed');
  } catch (error) {
    const durationMs = Date.now() - start;
    logger.error({ job: name, runId, status: 'failed', durationMs, error: error.message }, 'Job failed');
    // TODO: send alert to developer (email / Slack) in Phase 2
  }
}

interface JobResult {
  processed: number;
  succeeded: number;
  failed: number;
}

async function withRetry<T>(fn: () => Promise<T>, opts: { retries: number; backoffMs: number }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.retries) {
        await sleep(opts.backoffMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Job Implementations

```typescript
// src/server/jobs/weekly-review-reminder.ts
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { sendNotification } from '../services/notification.js';

export async function sendWeeklyReviewReminders(): Promise<JobResult> {
  // Find families where today is Sunday and either child or parent hasn't submitted review
  const pendingReviews = await db.execute(sql`
    WITH this_week AS (
      SELECT CURRENT_DATE - INTERVAL '1 day' * (EXTRACT(DOW FROM CURRENT_DATE)::int - 1) AS week_start
    )
    SELECT DISTINCT c.family_id, c.id AS child_id, c.name
    FROM children c
    CROSS JOIN this_week tw
    LEFT JOIN weekly_reviews wr ON wr.child_id = c.id AND wr.week_start_date = tw.week_start
    WHERE wr.id IS NULL OR wr.child_committed_at IS NULL OR wr.parent_committed_at IS NULL
  `);

  let succeeded = 0;
  let failed = 0;

  for (const row of pendingReviews.rows) {
    try {
      await sendNotification({
        familyId: row.family_id,
        childId: row.child_id,
        type: 'weekly_review_reminder',
        title: '本周复盘时间到啦',
        body: '点击进入每周复盘',
      });
      succeeded++;
    } catch (err) {
      logger.warn({ childId: row.child_id, err }, 'Failed to send review reminder');
      failed++;
    }
  }

  return { processed: pendingReviews.rows.length, succeeded, failed };
}
```

```typescript
// src/server/jobs/fulfillment-reminder.ts
export async function sendFulfillmentReminders(): Promise<JobResult> {
  const stale = await db.execute(sql`
    SELECT rr.id, rr.child_id, rr.reward_id, rr.point_cost, rr.reviewed_at,
           c.family_id, r.title AS reward_title
    FROM reward_redemptions rr
    JOIN children c ON c.id = rr.child_id
    JOIN rewards r ON r.id = rr.reward_id
    WHERE rr.status = 'approved'
      AND rr.reviewed_at < NOW() - INTERVAL '7 days'
      AND rr.fulfilled_at IS NULL
      AND (rr.last_reminder_sent_at IS NULL OR rr.last_reminder_sent_at < NOW() - INTERVAL '1 day')
  `);

  let succeeded = 0;
  let failed = 0;

  for (const row of stale.rows) {
    try {
      await sendNotification({
        familyId: row.family_id,
        childId: row.child_id,
        type: 'fulfillment_reminder',
        title: '奖励兑现提醒',
        body: `「${row.reward_title}」已批准7天，记得兑现哦`,
      });

      await db.execute(sql`
        UPDATE reward_redemptions SET last_reminder_sent_at = NOW() WHERE id = ${row.id}
      `);

      succeeded++;
    } catch (err) {
      logger.warn({ redemptionId: row.id, err }, 'Failed to send fulfillment reminder');
      failed++;
    }
  }

  return { processed: stale.rows.length, succeeded, failed };
}
```

### Notification Service (Stub for MVP)

```typescript
// src/server/services/notification.ts
// MVP: In-app notification stored in DB; future: Web Push API

export async function sendNotification(input: NotificationInput): Promise<void> {
  await db.execute(sql`
    INSERT INTO notifications (family_id, child_id, type, title, body)
    VALUES (${input.familyId}, ${input.childId}, ${input.type}, ${input.title}, ${input.body})
  `);

  // TODO Phase 2: send Web Push notification via VAPID keys
}
```

### Scheduler Startup in Server

```typescript
// src/server/index.ts
import { startScheduler } from './jobs/scheduler.js';

const app = fastify();

// ... register routes ...

// Start scheduler only on the primary instance (not on preview deploys)
if (process.env.ENABLE_SCHEDULER === 'true') {
  startScheduler();
}

app.listen({ port: 3000, host: '0.0.0.0' });
```

### Why `ENABLE_SCHEDULER` Flag?

- Production deployment: `ENABLE_SCHEDULER=true` (Railway)
- Preview deployments: `ENABLE_SCHEDULER=false` (avoid duplicate cron firing)
- Local development: `ENABLE_SCHEDULER=false` (don't want reminders during dev)
- Tests: `ENABLE_SCHEDULER=false` (don't want background jobs during test runs)

## Alternatives Considered

### Alternative 1: Use a queue system (BullMQ + Redis)
- **Description**: Queue jobs in Redis; worker process consumes
- **Pros**: Distributed; retry built-in; visibility into queue state
- **Cons**: Adds Redis dependency; ops burden; overkill for MVP scale (3 jobs/day)
- **Rejection Reason**: In-process `node-cron` is simpler and sufficient. Migrate to BullMQ if jobs grow > 10 or need distributed execution.

### Alternative 2: Use Railway's Cron Jobs feature
- **Description**: Railway supports cron commands (separate service that runs on schedule)
- **Pros**: Decoupled from web server; survives server restarts; independent scaling
- **Cons**: Cold start per invocation (~5s); can't share DB connection pool with web server; harder to test locally
- **Rejection Reason**: Adds operational complexity. In-process keeps everything together.

### Alternative 3: Use Vercel Cron Jobs
- **Description**: Vercel Cron calls an API endpoint on schedule
- **Pros**: No always-on process needed; integrates with Vercel
- **Cons**: Vercel Cron free tier limited to daily (not hourly); 10s serverless timeout; not suitable for backend that runs on Railway
- **Rejection Reason**: Stack mismatch (frontend on Vercel, backend on Railway). In-process on Railway is cleaner.

## Consequences

### Positive
- Zero infrastructure beyond Railway backend
- Single process, single source of truth for job state
- Easy to test: invoke job function directly in tests
- Timezone-aware (`Asia/Shanghai`)
- Built-in retry with exponential backoff
- Structured logging for observability

### Negative
- Jobs don't run if backend is down (e.g., during deploy)
- No distributed locking (only safe for single-instance)
- In-memory scheduling lost on restart (next invocation is next scheduled time)

### Risks
- **Risk**: Backend restart at scheduled time → job skipped → **Mitigation**: Idempotent jobs; missed job is recovered by next day's run for daily jobs; for weekly, manual trigger via admin endpoint
- **Risk**: Long-running job blocks event loop → **Mitigation**: All jobs are async with `await`; non-blocking; < 5s typical runtime
- **Risk**: Duplicate job execution (if Railway runs multiple instances) → **Mitigation**: `ENABLE_SCHEDULER=true` only on primary; if scaling to multiple instances, use advisory lock: `SELECT pg_try_advisory_lock(...)`
- **Risk**: Timezone misconfiguration → **Mitigation**: All cron schedules explicitly set `timezone: 'Asia/Shanghai'`; verify with test that logs correct next-run time

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.1 | 每日 00:00 重置当日任务完成状态 | Implicit (dated rows; no cron needed); daily 18:00 reminder is Phase 2 |
| §3.2 | 每周任务每周一 00:00 重置 | Implicit; weekly review reminder Sunday 18:00 |
| §3.3 | 每周日 18:00 弹出复盘提醒 | `cron.schedule('0 18 * * 0', ...)` |
| §3.4 | 超过7天未标记兑现，系统提醒家长 | Daily 09:00 fulfillment-reminder job |

## Performance Implications
- **CPU**: Negligible (3 jobs/day, each <5s)
- **Memory**: In-process scheduler adds <1MB
- **Load Time**: Scheduler starts in <100ms on server boot
- **Network**: One DB query per job; minimal

## Migration Plan
N/A — new codebase.

## Validation Criteria
- [ ] Scheduler starts on server boot when `ENABLE_SCHEDULER=true`
- [ ] Scheduler does NOT start when `ENABLE_SCHEDULER=false`
- [ ] Weekly review reminder fires at Sunday 18:00 Asia/Shanghai
- [ ] Fulfillment reminder fires daily 09:00 Asia/Shanghai
- [ ] Job logs include `runId`, `status`, `durationMs`, `result`
- [ ] Failed job retries up to 3 times with exponential backoff
- [ ] Manual job trigger via admin endpoint works (for missed jobs)
- [ ] All TDD_SPEC background job tests pass (to be added)

## Related Decisions
- ADR-0004 (Redemption State Machine — uses fulfillment reminder)
- ADR-0008 (Deployment — Railway runs scheduler)
