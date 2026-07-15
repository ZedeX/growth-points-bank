# ADR-0008: Deployment Topology (Vercel + Railway + Neon)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Vercel + Railway + Neon Postgres + GitHub Actions |
| Domain | DevOps / Deployment |
| Knowledge Risk | LOW — all platforms mature |
| References Consulted | PRD §7 (非功能需求) |
| Post-Cutoff APIs Used | None |
| Verification Required | Verify free tier limits against expected load |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack) |
| Enables | Continuous deployment; production environment |
| Blocks | None (can develop locally without deployment) |
| Ordering Note | Set up CI early; deployment can wait until MVP slice complete |

## Context

### Problem Statement
The app needs a deployment pipeline that:
- Costs $0 during MVP development (single family using it)
- Auto-deploys on push to main
- Supports preview environments for PR review
- Has HTTPS out of the box
- Handles the three components: static frontend, Node.js backend, Postgres database

### Constraints
- User on Windows 10 (dev environment); deployment shouldn't require Linux expertise
- No budget for paid hosting initially
- Chinese user → consider latency to Chinese users (Vercel/Neon regions are US/EU; CN access may be slow but acceptable for single-family MVP)
- GitHub-based workflow (user has GitHub account)

### Requirements
- Push to `main` → auto-deploy to production
- Push to PR branch → preview environment
- HTTPS enforced
- Database migrations run automatically on deploy
- Cron jobs run on backend (not Vercel serverless, which has timeout limits)

## Decision

### Topology

```
       ┌──────────────────────────────────────┐
       │            GitHub Repo              │
       │  apps/web · apps/api · packages/    │
       └────────────────┬───────────────────┘
                        │ push to main / PR
                        ▼
       ┌──────────────────────────────────────┐
       │         GitHub Actions CI           │
       │  lint → typecheck → test → build     │
       └────┬───────────────────────────┬─────┘
            │                           │
            ▼                           ▼
   ┌────────────────┐         ┌──────────────────┐
   │     Vercel     │         │     Railway      │
   │  (Frontend)    │         │   (Backend)      │
   │                │         │                  │
   │ · Static SPA   │         │ · Fastify server │
   │ · Edge CDN     │         │ · Cron jobs     │
   │ · HTTPS auto   │         │ · HTTPS auto     │
   │ · Preview deploys │      │ · Persistent vol │
   └────────┬───────┘         └────────┬─────────┘
            │                          │
            │ /api/* proxy             │
            └─────────┬────────────────┘
                      ▼
            ┌──────────────────┐
            │  Neon Postgres   │
            │   (Database)     │
            │                  │
            │ · Serverless     │
            │ · Auto-scaled    │
            │ · Branch per env │
            └──────────────────┘
```

### Component Responsibilities

**Vercel (Frontend)**:
- Builds React SPA from `apps/web`
- Serves via Edge CDN with Brotli compression
- Rewrites `/api/*` to Railway backend (configured in `vercel.json`)
- Auto-deploys on push to main; preview deploys on PR
- Environment variables: `VITE_API_BASE_URL` (set per environment)

**Railway (Backend)**:
- Builds Node.js + Fastify from `apps/api`
- Runs `pnpm db:migrate && pnpm start` on deploy
- Provides HTTPS endpoint (auto)
- Runs cron jobs via node-cron (long-lived process, not serverless)
- Environment variables: `DATABASE_URL`, `PARENT_JWT_SECRET`, `CHILD_JWT_SECRET`, etc.
- Persistent volume for avatar uploads (mounted at `/data/avatars`)

**Neon (Database)**:
- Postgres 16, serverless
- Branch per environment: `main` (production), `preview/*` (per PR)
- Connection string in `DATABASE_URL` env var
- Point-in-time restore for disaster recovery

**GitHub Actions (CI)**:
- On every push/PR: lint, typecheck, test, build
- On main push: trigger Vercel + Railway deploys
- Scheduled: nightly DB backup verification

### CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main, 'feature/**']
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:unit
      - run: pnpm test:integration
      - run: pnpm build

  deploy-api:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: bervProject/railway-deploy@v3
        with:
          service: growth-points-bank-api
          token: ${{ secrets.RAILWAY_TOKEN }}

  deploy-web:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

### vercel.json (Frontend API Proxy)

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://growth-points-bank-api.up.railway.app/api/:path*"
    }
  ]
}
```

### Local Development

```bash
# Clone, install
pnpm install

# Start Postgres locally (Docker) OR use Neon dev branch
docker run -d --name gpb-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

# Run migrations
pnpm db:migrate

# Start both frontend and backend in parallel
pnpm dev
# → web: http://localhost:5173
# → api: http://localhost:3000
```

### Free Tier Limits (Verified 2026-07)

| Service | Free Tier | MVP Usage Estimate | OK? |
|---------|-----------|---------------------|-----|
| Vercel (Hobby) | 100GB bandwidth/mo, unlimited deploys | ~5GB/mo (1 family × 2 visits/day) | ✅ |
| Railway (Trial) | $5 credit, 500 hours, then sleeps | Trial expires; need Hobby ($5/mo) for prod | ⚠️ |
| Neon (Free) | 0.5GB storage, 100 compute hours/mo | ~50MB storage, ~5 compute hours/mo | ✅ |
| GitHub Actions | 2000 min/mo free | ~100 min/mo | ✅ |

**Note on Railway**: Free trial expires after 500 hours (~21 days). For continuous deployment, upgrade to Hobby plan ($5/mo). Alternative: use Fly.io free tier (3 shared-cpu-1x VMs with 256MB RAM).

**Decision**: Use Railway Hobby ($5/mo) for backend when trial expires. Total cost: ~$5/mo for MVP.

## Alternatives Considered

### Alternative 1: Single Vercel deployment (Next.js)
- **Description**: Migrate to Next.js; use API routes for backend
- **Pros**: Single deployment; simpler ops; Vercel-native
- **Cons**: Serverless function timeouts (10s free, 60s pro); no good story for cron jobs; would require rewriting ADR-0001 decision
- **Rejection Reason**: Cron jobs (weekly reset, 7-day reminder) need a long-lived process. Sticking with split deployment.

### Alternative 2: Self-host on a VPS (Hetzner/DigitalOcean)
- **Description**: Single $5/mo VPS running Docker Compose
- **Pros**: Full control; nofree-tier limits; can run all components
- **Cons**: Manual ops; HTTPS setup via Caddy/Traefik; backups manual; user less familiar with Linux ops
- **Rejection Reason**: Operational burden too high for single-dev project. Stick with managed services.

### Alternative 3: Cloudflare Pages + Workers + D1
- **Description**: All-Cloudflare stack
- **Pros**: Excellent free tier; global CDN; cheap
- **Cons**: Workers use V8 isolates (limited Node.js compatibility); D1 is SQLite-based (different from Postgres); would need to swap stack
- **Rejection Reason**: Stack mismatch. Stay on Postgres + Node.js.

## Consequences

### Positive
- Zero cost during trial period; ~$5/mo ongoing
- Auto-deploy on push
- Preview environments per PR (Vercel + Neon branch)
- HTTPS automatic
- Database migrations automatic
- Cron jobs run reliably on Railway (long-lived process)

### Negative
- Chinese users may see ~300ms latency to US/EU regions (acceptable for MVP)
- Railway Hobby plan cost after trial ($5/mo)
- Three services to manage (Vercel + Railway + Neon)

### Risks
- **Risk**: Railway free trial expires mid-development → **Mitigation**: Set billing alarm; budget $5/mo from start; have Fly.io fallback configured
- **Risk**: Neon compute hours exhausted under load → **Mitigation**: 100 hours/mo is plenty for MVP; connection pooling reduces compute
- **Risk**: Vercel rewrite to Railway has cold-start latency → **Mitigation**: Railway Hobby keeps instance warm; <100ms cold start
- **Risk**: GitHub Actions quota exhausted → **Mitigation**: 2000 min/mo is 20x what we'll use
- **Risk**: Avatar uploads fill Railway persistent volume → **Mitigation**: 1GB volume free; monitor usage; migrate to S3 in Phase 2

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §7.1 | Mobile-first responsive | Vercel Edge CDN delivers SPA fast globally |
| §7.2 | First screen < 2s on 4G | Vercel CDN + Brotli + code-splitting |
| §7.3 | HTTPS encryption | All three platforms auto-provision Let's Encrypt certs |
| §7.4 | 数据自动备份 | Neon PITR (point-in-time recovery) up to 7 days on free tier |
| §7.4 | 操作防误触 | Application-level concern; deployment provides foundation |

## Performance Implications
- **CPU**: Vercel Edge for static; Railway 1vCPU for backend
- **Memory**: Railway 512MB RAM for backend (sufficient for Node.js + Fastify)
- **Load Time**: Vercel CDN → ~50ms TTFB globally; SPA ~150KB gzipped → ~1.5s FCP on 4G
- **Network**: Vercel → Railway proxy adds ~50ms; backend → Neon adds ~20ms (same region)

## Migration Plan
N/A — greenfield deployment.

## Validation Criteria
- [ ] Push to main triggers Vercel + Railway deploy within 5 minutes
- [ ] HTTPS works on both `app.growth-points-bank.example.com` and `api.growth-points-bank.example.com`
- [ ] Database migrations run on deploy (verified by checking `drizzle_migrations` table)
- [ ] Cron jobs fire at 09:00 Asia/Shanghai (verified by log entry)
- [ ] Preview environment per PR works (Vercel preview + Neon branch)
- [ ] Total monthly cost < $10 during MVP

## Related Decisions
- ADR-0001 (Tech Stack — informs deployment choices)
- ADR-0010 (Background Jobs — runs on Railway backend)
