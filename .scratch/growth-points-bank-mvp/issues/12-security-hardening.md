# 12 — Security Hardening and Audit Log

**What to build:** Add defense-in-depth security controls across the API: rate limit all endpoints, configure Helmet headers per `DETAILED_DESIGN.md §6.6`, redact sensitive fields from logs, write audit log entries for all mutations. After this ticket, the API has baseline protection against common attacks (brute force, XSS, CSRF, log leakage) and a full audit trail for compliance/debugging.

**Blocked by:** 03 — Auth and Multi-Tenancy Foundation (rate limit and Helmet hooks need to plug into the auth pipeline).

**Status:** ready-for-agent

- [ ] `@fastify/rate-limit` plugin registered with per-route overrides (login 10/min, register 5/hour, checkins 60/min/user, default 300/min/user)
- [ ] `@fastify/helmet` registered with CSP from `DETAILED_DESIGN.md §6.6` (defaultSrc 'self', scriptSrc 'self', styleSrc 'self' 'unsafe-inline', imgSrc 'self' data:, connectSrc 'self')
- [ ] HSTS: maxAge=31536000, includeSubDomains
- [ ] `referrerPolicy: 'strict-origin-when-cross-origin'`
- [ ] Pino logger redact paths per `DETAILED_DESIGN.md §6.7`: `req.headers.authorization`, `req.body.password`, `req.body.access_token`, `password_hash`, `access_token`
- [ ] `src/server/plugins/auditLog.ts` `onResponse` hook: writes `audit_logs` row for any POST/PUT/PATCH/DELETE with `actorId`, `actorRole`, `action`, `resourceType`, `resourceId`, `metadata`
- [ ] Audit log excluded for GET requests (read-only, no audit needed for MVP)
- [ ] Audit log queries: parent can view their own family's audit logs (`GET /api/audit-logs?family_id=...`)
- [ ] Audit log retention: 90 days, then auto-archive (Phase 2)
- [ ] All security tests from `TDD_SPEC.md §16` pass
- [ ] All error flow tests from `TDD_SPEC.md §17.3` RED 8 pass: 11th login attempt in 1 minute → 429 RATE_LIMITED
- [ ] Sensitive data redaction test: log a register request → grep log output → `password` field shows `[REDACTED]`
- [ ] Audit log entry exists after: parent creates child, parent updates task, parent approves redemption, child commits review
