# 03 — Auth and Multi-Tenancy Foundation

**What to build:** Wire the dual-JWT authentication system (parent + child secrets) and the multi-tenant isolation preHandler so every downstream route inherits `request.familyId`, `request.auth`, and unified error handling. After this ticket, a parent can register + login + receive a JWT, and a child can hit a protected route using their token (the family-id is enforced via WHERE clauses downstream). Cross-family access returns 404 (not 403).

**Blocked by:** 02 — Database Schema and Migrations.

**Status:** ready-for-agent

- [ ] `src/server/plugins/auth.ts` preHandler: extract Bearer token, try verify with `PARENT_JWT_SECRET`, fall back to `CHILD_JWT_SECRET`, then query `children.token_version` for revocation check
- [ ] `src/server/plugins/tenant.ts` preHandler: inject `request.familyId` from auth payload
- [ ] `src/server/plugins/errorHandler.ts` global error handler implementing `docs/DETAILED_DESIGN.md §10.3` (AppError → status code, ZodError → 400, fallback → 500)
- [ ] `src/shared/errors.ts` with `AppError`, `ValidationError`, `InsufficientBalanceError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`
- [ ] `src/shared/schemas/auth.ts` Zod schemas for register/login request bodies
- [ ] `src/server/routes/auth.ts`: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- [ ] Argon2id password hashing via `argon2` package
- [ ] Parent JWT includes `sub`, `role: 'parent'`, `family_id`, `token_version`
- [ ] Child JWT includes `sub`, `role: 'child'`, `family_id`, `child_id`, `token_version`
- [ ] All tests from `TDD_SPEC.md §4` pass (register + login + duplicate rejection + weak password + missing fields)
- [ ] Security tests from `TDD_SPEC.md §16.2` pass (token expired, token revoked, parent token on child-only endpoint)
- [ ] Rate limit on `/api/auth/login` (10/min/IP) and `/api/auth/register` (5/hour/IP)
- [ ] Helmet plugin registered with CSP from `DETAILED_DESIGN.md §6.6`
