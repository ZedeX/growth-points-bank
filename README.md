# Summer Growth Points Bank 暑假成长积分银行

[![CI](https://github.com/ZedeX/growth-points-bank/actions/workflows/ci.yml/badge.svg)](https://github.com/ZedeX/growth-points-bank/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A family multi-tenant web platform that gamifies summer growth — children complete tasks across five growth dimensions (学习力/运动力/自控力/探索力/实践力), earn points, and redeem parent-defined rewards. Includes weekly double-blind reviews and encrypted growth diaries.

[中文版 README](./README.zh-CN.md)

## Features

- **Multi-family tenancy** — Application-level `family_id` row-level isolation (ADR-0006)
- **Dual JWT auth** — Separate parent/child secrets with `token_version` revocation (ADR-0002)
- **Points integrity** — SERIALIZABLE transaction isolation + partial UNIQUE index + CHECK constraints; balance derived from `point_transactions.balance_after` (ADR-0003)
- **Field-level encryption** — AES-256-GCM with HKDF-SHA256 per-row key derivation for PII (ADR-0009)
- **Double-blind weekly review** — Both sides commit before content is mutually visible (ADR-0005)
- **Redemption state machine** — pending → approved → fulfilled / rejected (ADR-0004)
- **Background jobs** — node-cron in-process with exponential backoff retry (ADR-0010)

## Tech Stack

- **Frontend**: React 18 + TypeScript 5 + Vite 5 + TanStack Query v5 + Zustand 4 + Tailwind CSS 3
- **Backend**: Node.js 20+ + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 (Neon)
- **Auth**: jose (JWT) + argon2 (password) + HMAC-SHA256 (access_token storage)
- **Logging**: pino + Sentry (Phase 2)
- **Monorepo**: pnpm workspace (`apps/web/` + `apps/api/` + `packages/shared/`)

## Project Structure

```
growth-points-bank/
├── apps/
│   ├── api/                    # Fastify backend
│   │   └── src/server/
│   │       ├── crypto/         # AES-256-GCM + HMAC-SHA256
│   │       ├── db/             # Drizzle schema, migrations, seed
│   │       ├── jobs/           # node-cron scheduler
│   │       ├── middleware/     # auth + multi-tenant
│   │       ├── routes/         # 8 route modules
│   │       └── services/       # auth + points ledger
│   └── web/                    # Vite + React frontend
│       └── src/
│           ├── api/            # API client
│           ├── pages/          # 8 page components
│           └── App.tsx         # Router + navigation
├── packages/
│   └── shared/                 # Zod schemas + constants
├── docs/
│   ├── architecture/           # 17 ADRs + review report + traceability
│   ├── PRD.md                  # Product requirements (781 lines)
│   ├── DETAILED_DESIGN.md      # 12-chapter technical design
│   ├── ARCHITECTURE.md         # C4 model architecture
│   ├── API.md                  # 18-chapter API reference
│   └── TDD_SPEC.md             # 97+4 test specifications
└── .github/workflows/ci.yml    # GitHub Actions CI
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 11+
- PostgreSQL 16+ (or [Neon](https://neon.tech) free tier)

### Installation

```bash
# Clone
git clone https://github.com/ZedeX/growth-points-bank.git
cd growth-points-bank

# Install dependencies
pnpm install

# Approve native builds (argon2, esbuild)
pnpm approve-builds argon2 esbuild es5-ext

# Copy env vars and fill in secrets
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT secrets, encryption key

# Run database migrations
pnpm db:migrate

# Seed demo data (5 dimensions + 45 task templates)
pnpm db:seed

# Start both frontend and backend in dev mode
pnpm dev
```

### Development

- Frontend: http://localhost:5173
- Backend: http://localhost:3000/api/health
- API docs: see `docs/API.md`

### Build

```bash
pnpm build       # Build all packages
pnpm typecheck   # TypeScript check
pnpm test        # Run all tests
```

## Architecture

This project follows a rigorous ADR-driven architecture. 17 Architecture Decision Records cover every major technical decision, from tech stack selection to encryption strategy. The architecture was reviewed and passed (MVP Phase 1 scope) on 2026-07-16.

Key ADRs:
- [ADR-0001](docs/architecture/adr-0001-tech-stack.md) — Tech Stack
- [ADR-0002](docs/architecture/adr-0002-authentication.md) — Dual JWT Authentication
- [ADR-0003](docs/architecture/adr-0003-points-integrity.md) — Points Integrity (SERIALIZABLE)
- [ADR-0009](docs/architecture/adr-0009-data-encryption.md) — Field-Level Encryption
- [ADR-0011](docs/architecture/adr-0011-task-and-dimension-management.md) — Task & Dimension Management
- [ADR-0014](docs/architecture/adr-0014-growth-diary-service.md) — Growth Diary Service
- [ADR-0015](docs/architecture/adr-0015-audit-log-compliance.md) — Audit Log & Compliance

Full review report: [architecture-review-2026-07-16.md](docs/architecture/architecture-review-2026-07-16.md)

## Domain Model

Five growth dimensions (PRD §3.1):

| Code | Name | Color |
|------|------|-------|
| `learning` | 学习力 | #2196F3 |
| `sports` | 运动力 | #FF9800 |
| `self_control` | 自控力 | #9C27B0 |
| `exploration` | 探索力 | #4CAF50 |
| `practice` | 实践力 | #F44336 |

Age groups: 6-8, 9-11, 12-14. Task difficulty multipliers: easy ×1.0, medium ×1.5, hard ×2.0.

## License

MIT
