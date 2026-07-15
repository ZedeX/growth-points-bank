# 04 — Family and Children CRUD

**What to build:** A parent can set up their family (name, summer dates, reminder time), create multiple child profiles, and generate per-child access tokens (with QR-friendly link). After this ticket, a parent who just registered can complete onboarding: create family → create 2 children → generate access tokens → hand links to children → children can hit `/api/me` and see their profile.

**Blocked by:** 03 — Auth and Multi-Tenancy Foundation.

**Status:** ready-for-agent

- [ ] `src/server/routes/family.ts`: `GET /api/family`, `PUT /api/family` (update name, summer dates, achievement wall toggle, review reminder time)
- [ ] `src/server/routes/children.ts`: `POST /api/children`, `GET /api/children`, `GET /api/children/:id`, `DELETE /api/children/:id`, `POST /api/children/:id/access-token` (regenerate, bumps `token_version`)
- [ ] Access token format: 64-char hex via `crypto.randomBytes(32).toString('hex')`
- [ ] Token expiration: 7 days from issuance (`tokenExpiresAt`)
- [ ] `src/server/repositories/ChildRepository.ts` with `findById(id, familyId)`, `findByAccessToken(token)`, `create`, `regenerateAccessToken`
- [ ] All `WHERE` clauses include `family_id` for tenant isolation (per ADR-0006)
- [ ] Cross-family access to child resource returns 404 NOT_FOUND (not 403)
- [ ] `src/shared/schemas/child.ts` Zod schemas with name (1-50), age_group enum, optional avatar URL
- [ ] All tests from `TDD_SPEC.md §4.3` pass (create child, unauthenticated rejection, access token generation)
- [ ] Multi-tenant tests from `TDD_SPEC.md §16.1` RED 2 pass (cross-family 404)
- [ ] Family onboarding E2E: register → create family → create child → generate token → child hits `/api/me` → sees own profile
