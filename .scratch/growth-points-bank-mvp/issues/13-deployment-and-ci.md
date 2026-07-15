# 13 — Deployment and CI/CD

**What to build:** Wire deployment topology per ADR-0008: Vercel (frontend) + Railway (backend) + Neon (database) + GitHub Actions CI. After this ticket, `git push origin main` triggers CI, and on green, both frontend and backend deploy to staging URLs.

**Blocked by:** 01 — Project Scaffolding (CI matrix), 02 — Database Schema and Migrations (Neon needs migrations), 06 — Daily Check-In and Points Ledger (backend needs a working endpoint to deploy), 08 — Growth Map and Check-In Frontend (frontend needs a working page).

**Status:** ready-for-agent

- [ ] `vercel.json` with rewrites: `/api/*` → `${RAILWAY_BACKEND_URL}/api/*`, all other paths → `index.html` (SPA fallback)
- [ ] Vercel project config: framework=preset-vite, buildCommand=`pnpm build:client`, outputDirectory=`dist/client`
- [ ] Railway `railway.toml` (or `Dockerfile`): Node 20 LTS, start command `node dist/server/index.js`, health check path `/api/health`
- [ ] Railway env vars: `DATABASE_URL`, `PARENT_JWT_SECRET`, `CHILD_JWT_SECRET`, `ENCRYPTION_MASTER_KEY`, `CORS_ORIGIN`, `ENABLE_SCHEDULER=true` (only on Railway, not Vercel)
- [ ] Neon database: branch `main` (production) + branch `preview` (auto-created per PR)
- [ ] `pnpm db:migrate` runs as Railway `preDeploy` hook
- [ ] GitHub Actions workflow `.github/workflows/deploy.yml`:
  - Job 1: `lint` + `typecheck` + `unit tests` (matrix: node 20)
  - Job 2: `integration tests` (needs PGlite, no external services)
  - Job 3: `component tests` (jsdom)
  - Job 4: `e2e tests` (Playwright against preview deployment)
  - Job 5: `deploy-backend` → Railway (only on main branch)
  - Job 6: `deploy-frontend` → Vercel (only on main branch)
- [ ] Preview deployments: every PR auto-creates Vercel preview + Railway preview + Neon preview branch
- [ ] Smoke test on production: 5-minute cron hitting `/api/health` → alerts on 5xx
- [ ] Performance test `TDD_SPEC.md §19` RED 1 runs against staging (100 concurrent checkins P95 < 500ms)
- [ ] README updated with deploy badges + env var matrix
- [ ] Rollback runbook: `git revert` + manual redeploy; documented in `docs/DEPLOYMENT.md`
