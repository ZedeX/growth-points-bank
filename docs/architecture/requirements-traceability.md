# Requirements Traceability Matrix — growth-points-bank

**Date**: 2026-07-16
**Source docs**: PRD.md, DETAILED_DESIGN.md, ARCHITECTURE.md
**ADRs in scope**: ADR-0001 ~ ADR-0010 (10 ADRs)
**Total TRs**: 70 (46 covered / 7 partial / 17 gap)

This is the companion file to `architecture-review-2026-07-16.md`. The full TR registry with requirement text is in `tr-registry.yaml`.

---

## Summary by System

| System | Total | ✅ Covered | ⚠️ Partial | ❌ Gap |
|---|---|---|---|---|
| auth | 9 | 8 | 1 | 0 |
| points | 8 | 7 | 1 | 0 |
| tasks | 7 | 1 | 2 | 4 |
| rewards | 3 | 1 | 0 | 2 |
| checkin | 4 | 3 | 1 | 0 |
| review | 6 | 6 | 0 | 0 |
| diary | 1 | 0 | 0 | 1 |
| mt (multi-tenant) | 3 | 2 | 1 | 0 |
| enc (encryption) | 4 | 4 | 0 | 0 |
| fe (frontend) | 6 | 6 | 0 | 0 |
| deploy | 5 | 4 | 1 | 0 |
| job (background) | 4 | 4 | 0 | 0 |
| xc (cross-cutting) | 5 | 0 | 0 | 5 |
| notify | 2 | 0 | 0 | 2 |
| report | 2 | 0 | 0 | 2 |
| audit | 1 | 0 | 0 | 1 |
| **Total** | **70** | **46** | **7** | **17** |

---

## Full Matrix

### System: auth (Authentication)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-auth-001 | Parent JWT HS256, 7d expiry, localStorage | PRD §4.1, DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-002 | Child JWT HS256, 7d, httpOnly cookie, token_version revocation | PRD §4.1, DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-003 | Argon2id password hashing (m=19456, t=2, p=1) | DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-004 | Login rate limit 5 attempts/15min/IP | PRD §7.2, DETAILED_DESIGN §8 | ADR-0002 | ✅ |
| TR-auth-005 | Parent JWT expiry and refresh strategy | DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-006 | Child JWT httpOnly cookie SameSite=Lax | DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-007 | token_version-based child session revocation | DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-008 | Child access_token plaintext DB lookup | DETAILED_DESIGN §6 | ADR-0002 | ✅ |
| TR-auth-009 | CSRF protection (SameSite + custom header) | DETAILED_DESIGN §8 | ADR-0002 (mentioned only; no formal CSRF ADR) | ⚠️ Partial |

### System: points (Points Integrity)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-points-001 | SERIALIZABLE transaction isolation | DETAILED_DESIGN §4.3 | ADR-0003 | ✅ |
| TR-points-002 | UNIQUE(source_type, source_id) constraint | DETAILED_DESIGN §5.2 | ADR-0003 (conflicts with DETAILED_DESIGN — see Conflict #4) | ✅ |
| TR-points-003 | CHECK(amount<>0) on point_transactions | DETAILED_DESIGN §5.1 | ADR-0003 | ✅ |
| TR-points-004 | balance_after as single source of truth | DETAILED_DESIGN §4.1 | ADR-0003 | ✅ |
| TR-points-005 | SERIALIZABLE retry backoff algorithm | DETAILED_DESIGN §4.4 | ADR-0003 (conflicts — see Conflict #3) | ✅ |
| TR-points-006 | Balance audit query for integrity verification | DETAILED_DESIGN §4.5 | ADR-0003 | ✅ |
| TR-points-009 | point_cost snapshot immutable on redemption | DETAILED_DESIGN §3 | ADR-0004 | ✅ |
| TR-points-010 | Multi-year data retention | PRD §7.3 "permanent" | None (PRD says permanent; no ADR covers retention) | ⚠️ Partial |

### System: tasks (Task Management)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-tasks-001 | Task CRUD (parent create/edit/delete) | PRD §3.1 | None — **ADR-0011 needed** | ❌ Gap |
| TR-tasks-002 | Task categorization (daily/weekly + growth dimension) | PRD §3.1, §5.1 | None — ADR-0011 needed | ❌ Gap |
| TR-tasks-003 | Task ageGroup adaptation (Grilling #7) | PRD §5.1 | DETAILED_DESIGN §2 only (no ADR) | ⚠️ Partial |
| TR-tasks-004 | Task visibility (sibling + offline conflict, Grilling #3, #8) | PRD §5.1 | DETAILED_DESIGN §4 only (no ADR) | ⚠️ Partial |
| TR-tasks-005 | Task completion triggers point award | PRD §3.1 | ADR-0003 (checkin as source_type) | ✅ |
| TR-tasks-006 | Point value rules (base + difficulty + dimension ratio) | PRD §3.1 | None — ADR-0011 needed | ❌ Gap |
| TR-tasks-007 | Custom growth dimensions (family-scoped) | PRD §5.1 | None — ADR-0011 needed | ❌ Gap |

### System: rewards (Reward Management)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-rewards-001 | Reward CRUD (parent create/edit/archive) | PRD §3.4 | None — **ADR-0012 needed** | ❌ Gap |
| TR-rewards-002 | Reward inventory / per-child weekly limits | PRD §3.4 | None — ADR-0012 needed | ❌ Gap |
| TR-rewards-003 | Redemption state machine (4 states + transitions) | PRD §3.4 | ADR-0004 | ✅ |

### System: checkin (Daily Check-in)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-checkin-001 | Daily dated rows (no cron reset needed) | PRD §3.1 | ADR-0010 | ✅ |
| TR-checkin-003 | Checkin creates point_transaction | PRD §3.1 | ADR-0003 | ✅ |
| TR-checkin-004 | Sibling visibility (Grilling #3) | PRD §5.1 | ADR-0006 | ✅ |
| TR-checkin-005 | Offline conflict (last-write + alert, Grilling #8) | PRD §5.1 | DETAILED_DESIGN §4 only (no ADR) | ⚠️ Partial |

### System: review (Weekly Review Double-Blind)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-review-001 | Double-blind commit scheme (hash commitment) | PRD §3.3, Grilling #4 | ADR-0005 | ✅ |
| TR-review-002 | CHECK constraint on commit state | DETAILED_DESIGN §5.1 | ADR-0005 | ✅ |
| TR-review-003 | FOR UPDATE row lock during aggregate | DETAILED_DESIGN §4 | ADR-0005 | ✅ |
| TR-review-004 | Access log audit table | DETAILED_DESIGN §10 | ADR-0005 (BIGSERIAL — see Conflict #5) | ✅ |
| TR-review-005 | Sunday 18:00 reminder cron | PRD §3.3 | ADR-0010 | ✅ |
| TR-review-006 | Aggregate computation at lock time | DETAILED_DESIGN §4 | ADR-0005 | ✅ |

### System: diary (Growth Diary)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-diary-001 | Growth diary CRUD (child create/edit, parent view) | PRD §3.5 | None — **ADR-0014 needed** | ❌ Gap |

### System: mt (Multi-Tenant Isolation)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-mt-001 | Application-level family_id row-level filter | PRD §4.2, DETAILED_DESIGN §7 | ADR-0006 | ✅ |
| TR-mt-002 | Cross-family test coverage infrastructure | DETAILED_DESIGN §7 | ADR-0006 (mentioned only; no formal test infra ADR) | ⚠️ Partial |
| TR-mt-003 | 404 (not 403) on cross-family access | DETAILED_DESIGN §7 | ADR-0006 | ✅ |

### System: enc (Data Encryption)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-enc-001 | AES-256-GCM field encryption | PRD §7.3, DETAILED_DESIGN §8 | ADR-0009 | ✅ |
| TR-enc-002 | HKDF-SHA256 envelope key derivation (Master → per-table → per-row) | DETAILED_DESIGN §8 | ADR-0009 | ✅ |
| TR-enc-003 | Encrypted fields list (children.name/avatar, diaries, reviews) | DETAILED_DESIGN §8 | ADR-0009 (conflicts with ADR-0005 — see Conflict #7) | ✅ |
| TR-enc-005 | Key rotation procedure | DETAILED_DESIGN §8 | ADR-0009 (script documented; validation pending) | ✅ |

### System: fe (Frontend State)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-fe-001 | TanStack Query for server state | DETAILED_DESIGN §12 | ADR-0007 | ✅ |
| TR-fe-002 | Zustand for UI state | DETAILED_DESIGN §12 | ADR-0007 | ✅ |
| TR-fe-003 | React Router for URL state | DETAILED_DESIGN §12 | ADR-0007 | ✅ |
| TR-fe-004 | Optimistic updates | DETAILED_DESIGN §12 | ADR-0007 | ✅ |
| TR-fe-005 | partialize for persistence (selectedChildId) | DETAILED_DESIGN §12 | ADR-0007 | ✅ |
| TR-fe-008 | Optimistic update rollback pattern | DETAILED_DESIGN §12 | ADR-0007 | ✅ |

### System: deploy (Deployment Topology)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-deploy-001 | Vercel frontend hosting | DETAILED_DESIGN §10 | ADR-0008 | ✅ |
| TR-deploy-002 | Railway backend hosting ($5/mo Hobby) | DETAILED_DESIGN §10 | ADR-0008 | ✅ |
| TR-deploy-003 | Neon Postgres (serverless, free tier) | DETAILED_DESIGN §10 | ADR-0008 | ✅ |
| TR-deploy-004 | GitHub Actions CI | DETAILED_DESIGN §10 | ADR-0008 | ✅ |
| TR-deploy-006 | Preview deploys isolation (ENABLE_SCHEDULER=false) | DETAILED_DESIGN §10 | ADR-0008 (mentioned; no detail) | ⚠️ Partial |

### System: job (Background Jobs)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-job-001 | node-cron in-process scheduler | DETAILED_DESIGN §10 | ADR-0010 | ✅ |
| TR-job-002 | ENABLE_SCHEDULER flag for primary instance | DETAILED_DESIGN §10 | ADR-0010 | ✅ |
| TR-job-003 | Sunday 18:00 weekly review reminder | PRD §3.3 | ADR-0010 | ✅ |
| TR-job-005 | pg_try_advisory_lock for multi-instance safety | DETAILED_DESIGN §10 | ADR-0010 (mentioned in Risks section) | ✅ |

### System: xc (Cross-Cutting Concerns)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-xc-001 | Unified error code system | DETAILED_DESIGN §9 | None — **ADR-0013 needed** | ❌ Gap |
| TR-xc-002 | API-wide rate limiting (beyond auth) | DETAILED_DESIGN §8 | None — ADR-0013 needed | ❌ Gap |
| TR-xc-003 | Security headers (CSP, HSTS, X-Frame-Options) | DETAILED_DESIGN §8 | None — ADR-0013 needed | ❌ Gap |
| TR-xc-004 | Health check endpoints (/health, /ready) | ADR-0008 implied | None — ADR-0013 needed | ❌ Gap |
| TR-xc-009 | Data export (PDF) + 30-day deletion | PRD Grilling #9 | None — **ADR-0016 needed** | ❌ Gap |

### System: notify (Notifications)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-notify-001 | In-app notifications (table + fetch API) | DETAILED_DESIGN §10 | None — **ADR-0013 needed** | ❌ Gap |
| TR-notify-002 | Web Push (Phase 2, VAPID keys) | DETAILED_DESIGN §10 | None — ADR-0013 needed (Phase 2) | ❌ Gap |

### System: report (Reporting & Analytics)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-report-001 | Growth reports (weekly/monthly/dimension aggregation) | PRD §5.2 | None — **ADR-0017 needed** | ❌ Gap |
| TR-report-002 | Data visualization (trend chart, dimension radar) | PRD §5.2 | None — ADR-0017 needed | ❌ Gap |

### System: audit (Audit Log)

| TR ID | Requirement | Source | ADR Coverage | Status |
|---|---|---|---|---|
| TR-audit-001 | Audit log for parent critical operations (login, points adjust, reward approval) | PRD §7.3 implied | None — **ADR-0015 needed** | ❌ Gap |

---

## ADR → TR Reverse Index

For each ADR, the TRs it covers:

| ADR | TRs Covered |
|---|---|
| ADR-0001 (Tech Stack) | (foundational; all TRs depend on it) |
| ADR-0002 (Authentication) | TR-auth-001, 002, 003, 004, 005, 006, 007, 008, 009 |
| ADR-0003 (Points Integrity) | TR-points-001, 002, 003, 004, 005, 006; TR-tasks-005; TR-checkin-003 |
| ADR-0004 (Redemption SM) | TR-rewards-003; TR-points-009 |
| ADR-0005 (Double-Blind Review) | TR-review-001, 002, 003, 004, 006 |
| ADR-0006 (Multi-Tenant) | TR-mt-001, 002, 003; TR-checkin-004 |
| ADR-0007 (Frontend State) | TR-fe-001, 002, 003, 004, 005, 008 |
| ADR-0008 (Deployment) | TR-deploy-001, 002, 003, 004, 006 |
| ADR-0009 (Data Encryption) | TR-enc-001, 002, 003, 005 |
| ADR-0010 (Background Jobs) | TR-checkin-001; TR-review-005; TR-job-001, 002, 003, 005 |

---

## Gaps by Suggested ADR

| Suggested ADR | TRs to Cover | Blocking Issues |
|---|---|---|
| ADR-0011 (Task & Dimension Management) | TR-tasks-001, 002, 006, 007 | #02, #03 |
| ADR-0012 (Reward Management & Inventory) | TR-rewards-001, 002 | #04 |
| ADR-0013 (Cross-Cutting Concerns) | TR-xc-001, 002, 003, 004; TR-notify-001, 002 | multiple |
| ADR-0014 (Growth Diary Service) | TR-diary-001 | #05 (TBD) |
| ADR-0015 (Audit Log & Compliance) | TR-audit-001 | — |
| ADR-0016 (Data Lifecycle) | TR-xc-009 | PRD Grilling #9 |
| ADR-0017 (Reporting & Analytics) | TR-report-001, 002 | — |
| ADR-0018 (Account Deletion Flow) | (compliance gap, no explicit TR) | — |

---

## Notes on Coverage Decisions

- **TR-auth-009 (CSRF)** marked Partial: ADR-0002 mentions `SameSite=Lax + custom header check` but no dedicated CSRF ADR exists. Treat as covered for MVP if the ADR-0002 mention is sufficient; otherwise elevate to ADR-0013.
- **TR-points-010 (retention)** marked Partial: PRD §7.3 says "permanent retention" but no ADR explicitly addresses multi-year storage strategy; ADR-0008 implies Neon 7-day PITR which is backup, not retention.
- **TR-enc-005 (key rotation)** marked Covered: ADR-0009 §"Key Rotation" includes full implementation script. Validation is tracked separately as a Phase 5 finding, not a coverage gap.
- **TR-job-005 (advisory lock)** marked Covered: ADR-0010 §Risks explicitly mentions `SELECT pg_try_advisory_lock(...)` mitigation, sufficient for single-instance MVP.
