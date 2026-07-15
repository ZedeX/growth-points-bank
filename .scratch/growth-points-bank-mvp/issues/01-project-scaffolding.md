# 01 — Project Scaffolding

**What to build:** Initialize the monorepo skeleton so that all later vertical slices can drop in routes, components, and tests without re-deciding folder layout, linting, or tooling. A developer running `pnpm install && pnpm dev` should get a working (empty) Vite + React frontend served at `localhost:5173` and a Fastify backend at `localhost:3000/api/health` returning `{ status: "healthy" }`.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `package.json` with pnpm workspace + scripts (`dev`, `build`, `test`, `lint`, `typecheck`)
- [ ] TypeScript config (`tsconfig.json`) with strict mode, path aliases `@shared/*`, `@server/*`, `@client/*`
- [ ] Vite config with React plugin, proxy `/api/*` to `localhost:3000`
- [ ] Vitest config with environment presets (`jsdom` for component tests, `node` for integration)
- [ ] Tailwind CSS config with brand color palette (`#4CAF50` 清新绿 + dimension colors from PRD §3.1)
- [ ] Fastify skeleton: `src/server/app.ts` + `src/server/index.ts` with `/api/health` route
- [ ] ESLint + Prettier config aligned with project conventions
- [ ] `.env.example` listing all required env vars (DB URL, JWT secrets, encryption key)
- [ ] `.gitignore` covering `node_modules`, `.env`, `dist`, `coverage`, `.scratch/local/`
- [ ] GitHub Actions workflow file with `install`, `lint`, `typecheck`, `test` matrix
- [ ] CI badge in README linking to workflow status
- [ ] Existing docs (`docs/*.md`, `docs/architecture/*.md`) preserved and linked from README
