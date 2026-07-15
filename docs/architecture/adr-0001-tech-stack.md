# ADR-0001: Tech Stack Selection

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | React 18 + TypeScript 5 + Node.js 20 LTS + Fastify 4 + PostgreSQL 16 |
| Domain | Web Application (Mobile-first H5) |
| Knowledge Risk | LOW — all components are mature and pre-LLM-cutoff |
| References Consulted | PRD §1.6, §7.1, §7.2, §7.5 |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | None (foundational) |
| Enables | ADR-0002 ~ ADR-0010 (all downstream ADRs) |
| Blocks | All epics — implementation cannot start until this is Accepted |
| Ordering Note | First ADR; pin versions in `package.json` before any code is written |

## Context

### Problem Statement
The Summer Growth Points Bank is a mobile-first H5 Web app requiring:
- Real-time point accounting with strict transactional integrity
- Multi-tenant family-level data isolation
- Two distinct auth surfaces (parent password-based, child token-based)
- Background scheduled jobs (weekly reset, 7-day fulfillment reminders)
- Sub-2s first-screen load on 4G, sub-500ms check-in response

### Constraints
- Single developer (user); no large team
- Dev environment is Windows 10 x64 with PowerShell 7
- GBK encoding hazards on Windows → all tooling must enforce UTF-8
- Cross-summer data retention (potentially years of history)
- No PII collected beyond name/avatar/age group

### Requirements
- Mobile-first responsive (375-768px width)
- Touch-optimized (min 44x44px tap targets)
- HTTPS-only in production
- Sub-500ms check-in API response
- Sub-2s first-screen load on 4G

## Decision

### Frontend Stack
- **Framework**: React 18 + TypeScript 5
- **Build tool**: Vite 5 (ESBuild-based, fast HMR)
- **Routing**: React Router 6
- **Server state**: TanStack Query (React Query) v5
- **UI state**: Zustand (small footprint, no boilerplate)
- **Styling**: Tailwind CSS 3 + CSS Modules for component-scoped styles
- **Forms**: React Hook Form + Zod (schema shared with backend)
- **Testing**: Vitest + Testing Library + MSW

### Backend Stack
- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify 4 (preferred over Express for built-in schema validation and ~2x throughput)
- **ORM**: Drizzle ORM (TypeScript-native, schema-first, SQL-first; no magic)
- **Validation**: Zod (shared types with frontend via `@growth-points-bank/shared`)
- **Auth**: JWT via `jose`; password hashing via `argon2` (Argon2id)
- **Testing**: Vitest + supertest + PGlite (in-memory Postgres)

### Data Layer
- **Database**: PostgreSQL 16 (production) / PGlite (in-memory tests)
- **Migrations**: Drizzle Kit (`drizzle-kit generate` + `migrate`)
- **Caching**: None in MVP (Postgres sufficient); revisit Redis in Phase 2
- **File Storage**: Local FS for avatars in MVP; S3-compatible in Phase 2

### Deployment Topology
- **Frontend**: Vercel (free tier sufficient for MVP scale)
- **Backend**: Railway (or Fly.io fallback)
- **Database**: Neon serverless Postgres (free tier)
- **CI**: GitHub Actions (lint, typecheck, test, build, deploy on main push)

### Architecture Diagram

```
        ┌──────────────────────────────────────────────┐
        │           Browser (Mobile/Tablet/PC)         │
        │   React 18 SPA · Vite · Tailwind · Zustand   │
        └────────────────────┬─────────────────────────┘
                             │ HTTPS
                             ▼
        ┌──────────────────────────────────────────────┐
        │              Vercel Edge/CDN                 │
        │   Static assets · SPA fallback · gzip/brotli │
        └────────────────────┬─────────────────────────┘
                             │ /api/* JSON (proxy)
                             ▼
        ┌──────────────────────────────────────────────┐
        │       Backend (Railway / Fly.io)             │
        │  ┌─────────────────────────────────────────┐ │
        │  │ Fastify 4 · Zod schema validation      │ │
        │  │ JWT auth middleware                     │ │
        │  │ Drizzle ORM · TypeScript                │ │
        │  │ Cron scheduler (node-cron)              │ │
        │  └─────────────────────────────────────────┘ │
        └────────────────────┬─────────────────────────┘
                             │ TLS
                             ▼
        ┌──────────────────────────────────────────────┐
        │         Neon Postgres 16 (serverless)       │
        │   Family-isolated rows · Drizzle migrations │
        └──────────────────────────────────────────────┘
```

### Key Interfaces
- All HTTP routes under `/api/*` (e.g., `/api/auth/register`)
- JSON request/response bodies; UTF-8 only
- Bearer token auth via `Authorization: Bearer <jwt>` header
- Standardized error envelope:
  ```json
  { "error": { "code": "STRING_CODE", "message": "Human-readable", "details": {} } }
  ```
- All timestamps in ISO 8601 UTC; dates as `YYYY-MM-DD`

## Alternatives Considered

### Alternative 1: Python + FastAPI + React
- **Description**: Use FastAPI for backend (aligns with user's Python background)
- **Pros**: User has Python familiarity; automatic OpenAPI docs; async-native
- **Cons**: Two languages break end-to-end TypeScript type safety; loses shared Zod schemas between FE/BE; user also has Java background, so Python isn't a unique advantage
- **Rejection Reason**: End-to-end TypeScript type safety is more valuable for a single-dev project than Python familiarity. Drizzle ORM provides superior type ergonomics for this scale.

### Alternative 2: Next.js 14 full-stack
- **Description**: Single Next.js app with API routes / server actions
- **Pros**: Single deployment; SSR for first-screen; great DX; Vercel-native
- **Cons**: Serverless function timeouts (10s free / 60s pro) may be too short for cron jobs and data export; harder to test backend in isolation; over-coupled to Vercel
- **Rejection Reason**: Need dedicated backend for scheduled jobs (weekly reset, 7-day reminder) and future PDF export. SPA sufficient — no SEO needs for this private family app.

### Alternative 3: Java + Spring Boot + React
- **Description**: User's known stack
- **Pros**: User familiarity; JPA maturity; gRPC support
- **Cons**: Heavier deployment; slower dev cycle; JPA overkill for ~9 entities; Spring Boot startup 5-10s vs Fastify <1s
- **Rejection Reason**: Overkill for MVP scale. Node.js + TypeScript gives faster iteration and unifies the language across the stack.

## Consequences

### Positive
- End-to-end TypeScript = single type system, fewer runtime type errors, shared Zod schemas
- Drizzle ORM = SQL-first, transparent query inspection, no N+1 surprises
- Fastify = built-in schema validation, ~2x faster than Express, first-class TypeScript support
- Vercel/Neon/Railway free tiers cover MVP scale (one family = trivial load)
- Vitest unifies FE/BE testing; same config, same patterns

### Negative
- User less familiar with Fastify/Drizzle (learning curve for these specific libs)
- Two separate deployments (FE on Vercel, BE on Railway) vs single Next.js
- Drizzle has fewer "magic" features than Prisma (intentional, but more boilerplate for some patterns)

### Risks
- **Risk**: Neon free tier may hit connection limits under load → **Mitigation**: Use Drizzle's connection pooling; one connection per serverless instance is sufficient for MVP
- **Risk**: Vercel free tier bandwidth limits (100GB/mo) → **Mitigation**: SPA is ~150KB gzipped; even 1000 daily visits = ~4.5GB/mo, well within limits
- **Risk**: User unfamiliar with Drizzle migrations → **Mitigation**: Provide `pnpm db:generate` + `pnpm db:migrate` scripts; use Drizzle Studio for visual inspection
- **Risk**: Windows GBK encoding corrupts SQL files → **Mitigation**: Force `UTF-8` in `drizzle.config.ts`; all scripts set `PYTHONIOENCODING=utf-8` and `NODE_OPTIONS=--encoding=UTF-8`

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §1.6 | Mobile-first H5 Web app | React + Tailwind responsive design |
| §7.1 | Responsive 375-768px | Tailwind breakpoints (sm/md/lg) |
| §7.2 | First screen < 2s on 4G | Vite code-splitting + Vercel CDN + Brotli |
| §7.2 | Check-in response < 500ms | Fastify + Drizzle raw SQL, no ORM N+1 |
| §7.3 | HTTPS encryption | Enforced by Vercel/Railway/Neon (TLS termination) |
| §7.5 | Chrome 140+/Safari 18+/Edge 115+ | Modern ES2022 features safe to use; no IE support |

## Performance Implications
- **CPU**: Minimal — Fastify event loop handles family-scale traffic trivially; <5% CPU under nominal load
- **Memory**: ~80MB backend baseline (Fastify + Drizzle + connection pool); React SPA ~150KB gzipped initial bundle
- **Load Time**: Vite + Vercel CDN → first contentful paint < 1.5s on 4G; TTI < 2s
- **Network**: All API JSON; max ~10KB per request/response; check-in round-trip ~3KB

## Migration Plan
N/A — new project, no existing code to migrate.

## Validation Criteria
- [ ] `pnpm typecheck` passes with no errors in `apps/web`, `apps/api`, `packages/shared`
- [ ] Backend cold-start time < 3s (measured on Railway free tier)
- [ ] All 64 TDD_SPEC tests pass against PGlite in CI
- [ ] Lighthouse mobile score > 90 on all four metrics (Performance, Accessibility, Best Practices, SEO)
- [ ] API p50 response < 100ms for `GET /api/checkins/today` with seeded data

## Related Decisions
- ADR-0002 Authentication Strategy (depends on this)
- ADR-0003 Points Transaction Integrity (depends on this)
- ADR-0007 Frontend State Management (depends on this)
- ADR-0008 Deployment Topology (depends on this)
