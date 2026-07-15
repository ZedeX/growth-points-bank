# ADR-0002: Authentication Strategy (Dual JWT — Parent Password + Child Link Token)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Fastify + `jose` JWT + `argon2` password hashing |
| Domain | Web Application Security / Authentication |
| Knowledge Risk | LOW — JWT and Argon2id are mature, pre-cutoff standards |
| References Consulted | PRD §2.1, §2.2, §4.1 |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack) |
| Enables | All API routes (every endpoint requires auth) |
| Blocks | Epic "Auth & Family Account" |
| Ordering Note | Must be Accepted before any protected route is implemented |

## Context

### Problem Statement
The app has two distinct user surfaces with very different security profiles:

1. **Parent** — authenticates with email/phone + password, has admin powers (CRUD tasks, rewards, audit check-ins, approve redemptions)
2. **Child** — accesses via a shared link/QR code with no password; should only see their own data; must not see siblings' data

A single auth strategy cannot safely cover both: child tokens must be revocable per-child, short-lived, and family-scoped; parent tokens need stronger proofing but longer lifetime.

### Constraints
- Children should not need to remember passwords (PRD §2.2: "无需独立注册")
- One child link must not be reusable for a sibling (PRD §4.1: "一个链接对应一个孩子，不可混用")
- Child token expires in 7 days (PRD §4.1)
- Children's tokens must be revocable by parent at any time
- All tokens must be stateless (no server-side session store) to keep backend simple

### Requirements
- Parent login: email OR phone + password (PRD §4.1)
- Password strength: minimum 8 chars, mixed case + digit (PRD test case §4.1)
- Child access: scan QR / click link → instant auth, no form
- Parent can regenerate child token (invalidates old token immediately)
- Different rate limits: parent = 5 login attempts / 15 min; child = unlimited (token-based)

## Decision

### Token Types

**Parent JWT** (issued on login):
```
Header: { alg: "HS256", typ: "JWT" }
Payload: {
  sub: <parent_uuid>,
  role: "parent",
  family_id: <family_uuid>,
  iat, exp
}
Expiry: 7 days
Signing key: process.env.PARENT_JWT_SECRET (separate from child secret)
```

**Child JWT** (issued on link redemption):
```
Header: { alg: "HS256", typ: "JWT" }
Payload: {
  sub: <child_uuid>,
  role: "child",
  family_id: <family_uuid>,
  iat, exp,
  token_version: <integer>  // bumps on parent revoke
}
Expiry: 7 days
Signing key: process.env.CHILD_JWT_SECRET (separate from parent secret)
```

### Auth Flow

```
Parent login:
  POST /api/auth/login {email_or_phone, password}
    → verify password with argon2.verify(stored_hash, input)
    → issue parent JWT (7d)
    → return { token, parent: {...} }

Child link redemption:
  GET /child/auth?token=<access_token>   (link/QR target)
    → look up Child row by access_token
    → check token_expires_at > now AND token_version matches
    → issue child JWT (7d, separate secret)
    → set httpOnly cookie `child_session` (SameSite=Lax, Secure, 7d)
    → redirect to /child/map

Token verification (every protected route):
  Fastify preHandler hook:
    → extract Bearer token from header OR child_session cookie
    → verify with appropriate secret (try parent first, then child)
    → attach request.auth = { role, sub, family_id }
    → next()
```

### Database Schema Additions

```sql
-- Child table already has access_token + token_expires_at per PRD §5.2
-- Add token_version for instant revocation:

ALTER TABLE children ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_children_access_token ON children(access_token) WHERE access_token IS NOT NULL;
```

### Password Policy
- Minimum 8 characters
- At least 1 uppercase + 1 lowercase + 1 digit
- Argon2id with: `memoryCost=19456, timeCost=2, parallelism=1`
- Failed login rate limit: 5 attempts / 15 min / per-IP (in-memory bucket)

### Parent Auth Middleware

```typescript
// src/server/middleware/auth.ts
export async function requireParent(request, reply) {
  if (request.auth?.role !== 'parent') {
    return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Parent role required' } });
  }
}

export async function requireChild(request, reply) {
  if (request.auth?.role !== 'child') {
    return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Child role required' } });
  }
}

// Use for routes that either role can hit (e.g., reading own data)
export async function requireAnyAuth(request, reply) {
  if (!request.auth) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
}
```

## Alternatives Considered

### Alternative 1: Single JWT secret, role in payload
- **Description**: One secret, role field distinguishes parent vs child
- **Pros**: Simpler config (one env var); less branching in middleware
- **Cons**: If parent secret leaks, attacker can forge child tokens; revoking all child tokens requires rotating shared secret (logs everyone out, including parents)
- **Rejection Reason**: Separation of secrets limits blast radius. Compromising child secret doesn't allow parent impersonation.

### Alternative 2: Server-side sessions (Redis)
- **Description**: Store session IDs in Redis; lookup on every request
- **Pros**: Instant revocation; fine-grained control; track active sessions
- **Cons**: Adds Redis dependency (cost + ops burden); latency per request; overkill for MVP scale (1-2 families)
- **Rejection Reason**: JWT + token_version pattern gives instant revocation without Redis. Revisit if scale grows.

### Alternative 3: Child uses password too
- **Description**: Children get accounts with passwords
- **Pros**: Standard pattern; unified code paths
- **Cons**: Violates PRD §2.2 (children must not register); young children (6-8) struggle with passwords; high friction
- **Rejection Reason**: Direct PRD violation; terrible UX for the target user.

## Consequences

### Positive
- Two JWT secrets = blast radius isolation
- `token_version` allows instant child token revocation without rotating the JWT secret
- Stateless = no Redis/session store
- Argon2id = current OWASP-recommended password hashing
- Cookie for child = no localStorage XSS exposure on child device

### Negative
- Two secrets to manage in env config
- Cookie-based child auth requires CSRF protection (use `SameSite=Lax` + custom header check)
- `token_version` requires a DB read on every child request (negligible cost; indexed)

### Risks
- **Risk**: Child link token leaked (e.g., shared on chat) → **Mitigation**: 7-day expiry; parent can regenerate from settings page; consider adding device fingerprint in Phase 2
- **Risk**: Parent JWT stolen from localStorage via XSS → **Mitigation**: Strict CSP; short-lived access token + refresh token pattern in Phase 2; for MVP, accept the risk (single-family scale)
- **Risk**: Argon2id CPU cost on slow servers → **Mitigation**: Tune `timeCost=2` (acceptable ~50ms on Railway free tier)
- **Risk**: Brute-force parent login → **Mitigation**: 5-attempt rate limit per IP per 15 min; exponential backoff

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §2.1 | Parent: 注册/登录家庭账户 | Email/phone + password registration & login |
| §2.2 | Child: 通过家长分享的链接/二维码进入（无需独立注册） | `GET /child/auth?token=...` issues child JWT via cookie |
| §4.1 | 注册方式：手机号或邮箱 | Both supported as identity |
| §4.1 | 孩子 Token 有效期 7 天 | Child JWT exp = 7d; access_token row expiry = 7d |
| §4.1 | 一个链接对应一个孩子，不可混用 | access_token UNIQUE per child row |
| §7.3 | 孩子 Token 定期失效 | 7-day expiry + parent-driven `token_version` bump |

## Performance Implications
- **CPU**: Argon2id verify ~50ms per login (one-time per session); JWT verify ~0.1ms (HMAC)
- **Memory**: JWT verification is stateless; no session cache needed
- **Load Time**: Auth check adds ~1ms to each request
- **Network**: One extra DB read per child request (token_version check); ~200 bytes per request

## Migration Plan
N/A — new project.

## Validation Criteria
- [ ] Parent login returns JWT with `role: "parent"` and `family_id`
- [ ] Child link redemption issues JWT with `role: "child"` and `family_id`
- [ ] Parent token secret cannot verify child tokens (and vice versa)
- [ ] Bumping `token_version` invalidates existing child JWTs within 1 request
- [ ] Argon2id verification completes in <100ms on Railway free tier
- [ ] Brute-force protection blocks 6th login attempt within 15 min window
- [ ] All TDD_SPEC §4 (auth tests) pass

## Related Decisions
- ADR-0001 (Tech Stack — provides Fastify + Jose)
- ADR-0006 (Multi-tenant Isolation — relies on `family_id` claim)
- ADR-0009 (Data Encryption — child access_token stored hashed)
