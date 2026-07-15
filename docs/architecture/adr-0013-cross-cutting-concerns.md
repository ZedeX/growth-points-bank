# ADR-0013: Cross-Cutting Concerns (Errors, Rate Limiting, Security Headers, Health, Notifications)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + `@fastify/rate-limit` + `@fastify/helmet` + `web-push` (Phase 2) + Drizzle ORM 0.30 + PostgreSQL 16 |
| Domain | Cross-cutting (Error Handling / Rate Limiting / Security Headers / Health / Notifications) |
| Knowledge Risk | LOW — all Fastify plugins are mature and pre-cutoff; `web-push` follows the standard W3C Push API |
| References Consulted | PRD §7.3 (数据安全), §7.4 (可用性); DETAILED_DESIGN §6.5 (速率限制), §6.6 (安全响应头), §9.5 (健康检查端点), §10.1–10.4 (错误处理); API.md §17 (错误码字典) |
| Post-Cutoff APIs Used | None |
| Verification Required | Verify `@fastify/rate-limit` `keyGenerator` signature against pinned v9; verify VAPID push flow on Chrome 140 / Safari 18 before Phase 2 |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack — Fastify/Drizzle), ADR-0002 (Auth — rate limit pattern + dual JWT), ADR-0006 (Multi-tenant — 404-not-403 on cross-family), ADR-0008 (Deployment — `/ready` probe for Railway), ADR-0010 (Background Jobs — `sendNotification` stub) |
| Enables | Epics "Notifications", "Reward Redemption" (redemption rate limit), all API error responses |
| Blocks | None |
| Ordering Note | Land error system + security headers + rate limit before the first protected route; create `notifications` table before wiring ADR-0010 job helpers |

## Context

### Problem Statement
Six concerns cut across every backend route and the frontend shell, yet none individually warrants a dedicated ADR. Grouping them under one umbrella avoids ADR sprawl while pinning the project-wide contracts before implementation:

1. **Unified error code system** — DETAILED_DESIGN §10.2 and API.md §17 specify string codes (`INSUFFICIENT_BALANCE`, `VALIDATION_ERROR`) with no domain grouping and no stable machine-readable numeric identity. Clients need a deterministic, versioned code to branch on.
2. **API-wide rate limiting** — ADR-0002 sets login brute-force protection (5/15min/IP) but no global ceiling exists; redemption and write-heavy endpoints are unprotected against accidental floods.
3. **Security headers** — DETAILED_DESIGN §6.6 sketches a CSP but omits HSTS preload, `X-Content-Type-Options`, `frame-ancestors`, and the production-only dev-toggle.
4. **Health check endpoints** — DETAILED_DESIGN §9.5 collapses liveness + readiness into one `/api/health` with DB latency; Railway needs a cheap liveness probe that does NOT touch the DB so deploys don't fail on a transient Neon cold-start.
5. **In-app notifications (Phase 1)** — ADR-0010 already stubs `sendNotification()` but no table or REST contract exists.
6. **Web Push (Phase 2)** — PRD §3.3/§3.4 expect push reminders; VAPID design must be fixed now so the schema is forward-compatible.

### Constraints
- Monorepo: shared error classes MUST live in `packages/shared/` so both `apps/api` and `apps/web` import one type.
- MVP runs on Railway Hobby (single instance) — in-memory rate-limit counters are acceptable; Redis is Phase 2 (DETAILED_DESIGN §6.5).
- Frontend is a Vite SPA on Vercel — Tailwind mandates `'unsafe-inline'` in `styleSrc`; no inline scripts.
- HSTS must NOT be sent over HTTP localhost in dev (browsers pin the host and break local dev).
- No WebSocket in MVP — notifications poll every 60s.
- Web Push is Phase 2 only; this ADR fixes its schema and contract but ships no code.

### Requirements
- **TR-xc-001**: Stable numeric error codes grouped by domain; one `AppError` hierarchy; Fastify global error handler normalizes all responses to `{ error: { code, message, details } }`.
- **TR-xc-002**: Global rate limit (100/min/key) with stricter overrides for auth (per ADR-0002) and redemption (10/min).
- **TR-xc-003**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy via `@fastify/helmet`; production only for HSTS.
- **TR-xc-004**: `GET /health` (liveness, no DB) and `GET /ready` (readiness, DB check) returning 200/503.
- **TR-notify-001**: `notifications` table + REST endpoints (list, unread-count, mark-read, delete); `sendNotification()` inserts a row.
- **TR-notify-002**: Web Push design (VAPID keys, `push_subscriptions` table, subscribe flow) — design only, not implemented in MVP.

## Decision

### 1. Unified Error Code System (TR-xc-001)

Define an `AppError` class hierarchy in `packages/shared/src/errors.ts` with a numeric `ErrorCode` enum grouped by domain (1xxx auth, 2xxx multi-tenant, 3xxx points, 4xxx rewards, 5xxx tasks, 6xxx reviews, 9xxx generic). This refines the string-code dictionaries in DETAILED_DESIGN §10.2 and API.md §17 into a canonical numeric taxonomy; the response shape is unchanged and the human `message` is preserved.

```typescript
// packages/shared/src/errors.ts
export enum ErrorCode {
  // Auth (1xxx)
  AUTH_INVALID_CREDENTIALS = 1001,
  AUTH_TOKEN_EXPIRED = 1002,
  AUTH_TOKEN_INVALID = 1003,
  AUTH_RATE_LIMITED = 1004,
  AUTH_CHILD_TOKEN_INVALID = 1005,

  // Multi-tenant (2xxx)
  MT_FAMILY_NOT_FOUND = 2001,        // 404 (not 403, per ADR-0006)
  MT_CROSS_FAMILY_ACCESS = 2002,     // 404 to prevent probing

  // Points (3xxx)
  POINTS_INSUFFICIENT_BALANCE = 3001,
  POINTS_SERIALIZATION_CONFLICT = 3002,
  POINTS_DUPLICATE_SOURCE = 3003,

  // Rewards (4xxx)
  REWARD_NOT_FOUND = 4001,
  REWARD_OUT_OF_STOCK = 4002,
  REWARD_WEEKLY_LIMIT_EXCEEDED = 4003,
  REWARD_INVALID_STATE_TRANSITION = 4004,

  // Tasks (5xxx)
  TASK_NOT_FOUND = 5001,
  TASK_ALREADY_CHECKED_IN = 5002,

  // Reviews (6xxx)
  REVIEW_ALREADY_COMMITTED = 6001,
  REVIEW_NOT_READY = 6002,

  // Generic (9xxx)
  VALIDATION_ERROR = 9001,
  RATE_LIMITED = 9002,
  INTERNAL_ERROR = 9999,
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, string[]>) {
    super(ErrorCode.VALIDATION_ERROR, 400, '请求参数校验失败', details);
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 409, message, details);
  }
}
```

Fastify global error handler normalizes every response. `AppError` → its `statusCode`; `ZodError` → 400 `VALIDATION_ERROR`; unknown → 500 `INTERNAL_ERROR` with the error logged at ERROR level (pino redaction per DETAILED_DESIGN §6.7). The numeric `code` is the machine contract; `message` is the human string (matches DETAILED_DESIGN §10.1).

```typescript
// apps/api/src/server/plugins/error-handler.ts
import { AppError, ErrorCode } from '@growth-points-bank/shared';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

app.setErrorHandler((err, request, reply) => {
  const requestId = request.id;
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: { code: ErrorCode.VALIDATION_ERROR, message: '请求参数校验失败', details: err.flatten(), requestId },
    });
  }
  logger.error({ err, requestId }, 'Unhandled error');
  return reply.status(500).send({
    error: { code: ErrorCode.INTERNAL_ERROR, message: '服务器内部错误', requestId },
  });
});
```

### 2. API-Wide Rate Limiting (TR-xc-002)

Use `@fastify/rate-limit` with a composite key of `ip:userId`. Global default 100 req/min. Auth endpoints keep ADR-0002's stricter limit (5/15min/IP for `/api/auth/login`). Redemption — the costliest write — gets 10/min. In-memory store for MVP; Redis store in Phase 2 (DETAILED_DESIGN §6.5).

```typescript
// apps/api/src/server/plugins/rate-limit.ts
import rateLimit from '@fastify/rate-limit';

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    const userId = (req as any).user?.id ?? 'anonymous';
    return `${req.ip}:${userId}`;
  },
  errorResponseBuilder: (_req, context) => ({
    error: {
      code: 9002,
      message: '请求过于频繁，请稍后再试',
      details: { retryAfterMs: context.ttl },
    },
  }),
});

// Override at route level — auth (per ADR-0002) + redemption (cost-intense)
app.post('/api/children/:childId/redemptions', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, redemptionHandler);

app.post('/api/auth/login', {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } },
}, loginHandler);
```

### 3. Security Headers (TR-xc-003)

`@fastify/helmet` with a strict CSP. `scriptSrc` is `'self'` only — Vite emits hashed asset bundles so no inline scripts. `styleSrc` allows `'unsafe-inline'` because Tailwind injects runtime styles. `imgSrc` includes `data:` and `blob:` for avatar uploads (ADR-0008 persistent volume). HSTS is production-only so HTTP localhost dev is not pinned.

```typescript
// apps/api/src/server/plugins/security-headers.ts
import helmet from '@fastify/helmet';
const isProd = process.env.NODE_ENV === 'production';

app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", process.env.API_URL ?? "'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: isProd
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false, // skip in dev to allow HTTP localhost
  xFrameOptions: { action: 'deny' },
  xContentTypeOptions: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
```

### 4. Health Check Endpoints (TR-xc-004)

Split DETAILED_DESIGN §9.5's single `/api/health` into a liveness probe (no DB call — fast, never fails on a DB cold-start) and a readiness probe (DB ping). Railway uses `/ready` as the deploy health gate (ADR-0008). `/health` returns 200 unconditionally once the process is up; `/ready` returns 503 if the DB ping exceeds 2s or errors.

```
GET /health   — liveness;  200 {"status":"ok"}                       (no DB check)
GET /ready    — readiness; 200 {"status":"ready","db":"ok"}
                           503 {"status":"not_ready","db":"error"}
```

```typescript
// apps/api/src/server/routes/health.ts
app.get('/health', async (_req, reply) => {
  return reply.status(200).send({ status: 'ok' });
});

app.get('/ready', async (_req, reply) => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db_timeout')), 2000)),
    ]);
    return reply.status(200).send({ status: 'ready', db: 'ok' });
  } catch {
    return reply.status(503).send({ status: 'not_ready', db: 'error' });
  }
});
```

### 5. In-App Notifications (TR-notify-001, Phase 1)

New `notifications` table in the `app` schema (UUID PK, consistent with DETAILED_DESIGN §11). `childId` is nullable — null means a parent-scoped notification. Hard-delete on `DELETE` for MVP simplicity (no soft-delete column to migrate).

```typescript
// apps/api/src/server/db/schema.ts (addition)
import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { appSchema } from './schema-base.js';

export const notifications = appSchema.table('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull(),
  childId: uuid('child_id'),              // nullable — null = parent notification
  type: varchar('type', { length: 50 }).notNull(),
  // 'weekly_review_reminder' | 'fulfillment_reminder' | 'daily_checkin_reminder'
  // | 'reward_approved' | 'reward_rejected' | 'points_revoked'
  title: varchar('title', { length: 100 }).notNull(),
  body: text('body').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

REST contract — JWT-scoped: a parent sees the whole family's notifications; a child sees only their own (`childId = sub`).

```
GET    /api/notifications             — list (filtered by JWT role)
GET    /api/notifications/unread-count — { count: number }
PATCH  /api/notifications/{id}        — mark as read
DELETE /api/notifications/{id}        — hard delete
```

`sendNotification()` (stubbed in ADR-0010) becomes the single writer:

```typescript
// apps/api/src/server/services/notification.ts
export async function sendNotification(input: NotificationInput): Promise<void> {
  await db.insert(notifications).values({
    familyId: input.familyId,
    childId: input.childId ?? null,
    type: input.type,
    title: input.title,
    body: input.body,
  });
  // TODO Phase 2 (TR-notify-002): also dispatch Web Push via VAPID keys
}
```

Frontend polls `GET /api/notifications/unread-count` every 60s (TanStack Query `refetchInterval: 60_000`). No WebSocket in MVP.

### 6. Web Push (TR-notify-002, Phase 2 — Design Only, NOT Implemented in MVP)

> **Phase 2 — not in MVP.** This subsection fixes the schema and contract now so the Phase 1 `notifications` table and `sendNotification` signature don't need a breaking change later. No code is shipped.

Use the `web-push` npm package with VAPID keys. The `push_subscriptions` table stores per-device Push API endpoints; a child can have multiple subscriptions (multi-device).

```typescript
// Phase 2 schema (design only)
export const pushSubscriptions = appSchema.table('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull(),
  childId: uuid('child_id'),               // nullable for parent subscriptions
  endpoint: text('endpoint').notNull(),    // Push API endpoint URL
  keysP256dh: varchar('keys_p256dh', { length: 200 }).notNull(),
  keysAuth: varchar('keys_auth', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:admin@growth-points-bank.example`.

Client subscribe flow: `serviceWorkerRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })` → POST the subscription to `/api/push/subscribe` → server stores a `push_subscriptions` row. On notification creation, `sendNotification` dispatches `web-push.sendNotification` to each of the recipient's subscriptions in parallel with the in-app DB insert; failures (410 Gone) delete the stale subscription. The child client receives the push → shows a system notification → frontend refetches unread-count.

## Alternatives Considered

### Alternative 1: String error codes (status quo per DETAILED_DESIGN §10.2)
- **Description**: Keep `INSUFFICIENT_BALANCE`, `VALIDATION_ERROR` etc. as the machine contract.
- **Pros**: Already documented; no migration; readable in logs.
- **Cons**: No domain grouping; clients must string-match; collision risk as the set grows; no stable numeric identity for client branching.
- **Rejection Reason**: Numeric codes grouped by domain give clients a stable, versionable contract; the human `message` field preserves readability. Supersedes the string dictionaries.

### Alternative 2: Redis-backed rate limiting in MVP
- **Description**: Use `@fastify/rate-limit` with the Redis store from day one.
- **Pros**: Works across multiple instances; survives restarts.
- **Cons**: Adds a Redis dependency (cost + ops) for a single-instance Railway MVP; DETAILED_DESIGN §6.5 explicitly defers Redis to Phase 2.
- **Rejection Reason**: In-memory counters suffice at single-family scale. Migrate when scaling beyond one instance.

### Alternative 3: Single combined health endpoint (DETAILED_DESIGN §9.5)
- **Description**: One `/api/health` returning liveness + DB latency + scheduler + encryption checks.
- **Pros**: Richer signal in one call.
- **Cons**: Liveness probe touches the DB → a Neon cold-start fails the probe and restarts the pod needlessly; Railway deploys flap.
- **Rejection Reason**: Split liveness/readiness is the standard K8s pattern Railway expects; `/health` must stay DB-free.

### Alternative 4: WebSocket for real-time notifications
- **Description**: Push notifications to the client over a socket.
- **Pros**: Sub-second delivery; no polling waste.
- **Cons**: Requires a long-lived connection + reconnect logic + Railway WebSocket support; overkill for ≤6 notifications/day per family.
- **Rejection Reason**: 60s polling is plenty for the reminder cadence (PRD §3.3/§3.4). Web Push (Phase 2) covers the real-time case.

## Consequences

### Positive
- One numeric error taxonomy imported by both apps; clients branch on stable codes.
- Global rate limit ceiling protects every route; auth and redemption get targeted protection.
- Strict CSP + HSTS + frame-deny harden the SPA against XSS and clickjacking.
- Liveness/readiness split prevents needless pod restarts on DB cold-starts.
- `notifications` table + `sendNotification` unblock ADR-0010's job helpers immediately.
- Web Push schema fixed now avoids a breaking Phase 2 migration.

### Negative
- Two health endpoints to maintain instead of one.
- Numeric codes require a mapping doc for humans (the `message` field covers this).
- Helmet CSP must be loosened (`unsafe-inline` for styles) due to Tailwind — a known Tailwind trade-off.
- Polling burns one request/60s per active client (negligible at MVP scale).

### Risks
- **Risk**: Numeric code renumbering after release breaks clients → **Mitigation**: Codes are append-only; deprecate, never renumber; bump a `CODE_VERSION` if ever needed.
- **Risk**: In-memory rate-limit counters reset on deploy → **Mitigation**: Acceptable at MVP scale; a burst right after deploy is bounded by the per-user key; Redis in Phase 2.
- **Risk**: HSTS preload locks out a misconfigured prod domain → **Mitigation**: Enable `preload` only after verifying cert auto-renewal; dev skips HSTS entirely.
- **Risk**: `notifications` table grows unbounded → **Mitigation**: Add a 30-day TTL cleanup job in Phase 2 (mirrors PRD §9 注销后30天删除).
- **Risk**: VAPID private key leak → **Mitigation**: Store in env/secret manager; rotate by re-subscribing all clients.

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §7.3 | 数据传输 HTTPS 加密 | HSTS + HTTPS enforcement via helmet (prod) |
| §7.3 | 孩子 Token 定期失效 | Auth rate limit (5/15min) supplements ADR-0002 token expiry |
| §7.4 | 操作防误触 | Security headers + rate limit reduce abuse surface |
| §3.3 | 每周日 18:00 弹出复盘提醒 | `sendNotification` inserts into `notifications` (Phase 1); Web Push Phase 2 |
| §3.4 | 超过7天未标记兑现，系统提醒家长 | ADR-0010 job → `sendNotification` → `notifications` table |
| §7.2 | 打卡操作响应 < 500ms | `/health` is DB-free; rate-limit check is in-memory (~1ms) |

## Performance Implications
- **CPU**: Rate-limit key generation ~0.1ms; helmet header injection ~0.1ms; error handler negligible.
- **Memory**: In-memory rate-limit bucket ~1KB per active key; notifications table rows are small (~200 bytes).
- **Load Time**: CSP adds zero bytes to the SPA bundle; HSTS is one response header.
- **Network**: `/health` adds one DB-free request per probe cycle; notification poll is one request/60s/client.

## Migration Plan
N/A — new codebase.

## Validation Criteria
- [ ] `AppError` + `ErrorCode` exported from `packages/shared/src/errors.ts`
- [ ] Every API error response matches `{ error: { code, message, details, requestId } }`
- [ ] Unknown error → 500 with `code: 9999` and ERROR log
- [ ] Global rate limit returns `code: 9002` (429) on the 101st req/min/key
- [ ] `/api/auth/login` enforces 5/15min/IP per ADR-0002
- [ ] `/api/children/:childId/redemptions` enforces 10/min
- [ ] Helmet sets CSP, HSTS (prod only), X-Frame-Options: deny, X-Content-Type-Options, Referrer-Policy
- [ ] `GET /health` returns 200 without touching the DB
- [ ] `GET /ready` returns 503 when DB ping times out (>2s)
- [ ] `notifications` table migrated; CRUD endpoints scoped by JWT role
- [ ] `sendNotification` inserts a row consumable by the ADR-0010 job
- [ ] Frontend polls `/api/notifications/unread-count` every 60s
- [ ] Web Push subsection marked Phase 2 — no code shipped

## Related Decisions
- ADR-0001 — Tech Stack (Fastify + Drizzle foundation)
- ADR-0002 — Auth (login rate limit pattern extended here to API-wide)
- ADR-0006 — Multi-tenant (404-not-403 reflected in `MT_*` codes)
- ADR-0008 — Deployment (`/ready` is Railway's deploy health gate)
- ADR-0009 — Data Encryption (pino redaction complements security headers)
- ADR-0010 — Background Jobs (`sendNotification` stub filled by this ADR's table + service)
