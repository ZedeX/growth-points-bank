# 暑假成长积分银行

[![CI](https://github.com/ZedeX/growth-points-bank/actions/workflows/ci.yml/badge.svg)](https://github.com/ZedeX/growth-points-bank/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

家庭多租户 Web 平台，将暑假成长游戏化 —— 孩子完成五大成长维度（学习力/运动力/自控力/探索力/实践力）的任务，赚取积分，兑换家长定义的奖励。包含每周双盲复盘和加密成长日记。

[English README](./README.md)

## 功能特性

- **多家庭租户隔离** — 应用层 `family_id` 行级过滤 (ADR-0006)
- **双 JWT 认证** — 家长/孩子分离 secret + `token_version` 即时吊销 (ADR-0002)
- **积分完整性** — SERIALIZABLE 事务隔离 + 部分 UNIQUE 索引 + CHECK 约束；余额从 `point_transactions.balance_after` 推导 (ADR-0003)
- **字段级加密** — AES-256-GCM + HKDF-SHA256 派生 per-row key，保护 PII (ADR-0009)
- **每周双盲复盘** — 双方提交后内容才互相可见 (ADR-0005)
- **兑换状态机** — pending → approved → fulfilled / rejected (ADR-0004)
- **后台作业** — node-cron 进程内调度 + 指数退避重试 (ADR-0010)

## 技术栈

- **前端**: React 18 + TypeScript 5 + Vite 5 + TanStack Query v5 + Zustand 4 + Tailwind CSS 3
- **后端**: Node.js 20+ + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 (Neon)
- **认证**: jose (JWT) + argon2 (密码) + HMAC-SHA256 (access_token 存储)
- **日志**: pino + Sentry (Phase 2)
- **Monorepo**: pnpm workspace (`apps/web/` + `apps/api/` + `packages/shared/`)

## 快速开始

### 前置条件

- Node.js 20+
- pnpm 11+
- PostgreSQL 16+（或 [Neon](https://neon.tech) 免费版）

### 安装

```bash
# 克隆
git clone https://github.com/ZedeX/growth-points-bank.git
cd growth-points-bank

# 安装依赖
pnpm install

# 批准原生模块构建 (argon2, esbuild)
pnpm approve-builds argon2 esbuild es5-ext

# 复制环境变量并填写密钥
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL、JWT secrets、encryption key

# 执行数据库迁移
pnpm db:migrate

# 填充演示数据（5 个维度 + 45 个任务模板）
pnpm db:seed

# 同时启动前后端开发模式
pnpm dev
```

### 开发

- 前端: http://localhost:5173
- 后端: http://localhost:3000/api/health
- API 文档: 见 `docs/API.md`

### 构建

```bash
pnpm build       # 构建所有包
pnpm typecheck   # TypeScript 检查
pnpm test        # 运行所有测试
```

## 架构

本项目采用严谨的 ADR 驱动架构。17 份架构决策记录覆盖每个重大技术决策，从技术栈选型到加密策略。架构于 2026-07-16 通过评审（MVP Phase 1 范围）。

完整评审报告：[architecture-review-2026-07-16.md](docs/architecture/architecture-review-2026-07-16.md)

## 领域模型

五大成长维度（PRD §3.1）：

| 代码 | 名称 | 颜色 |
|------|------|------|
| `learning` | 学习力 | #2196F3 |
| `sports` | 运动力 | #FF9800 |
| `self_control` | 自控力 | #9C27B0 |
| `exploration` | 探索力 | #4CAF50 |
| `practice` | 实践力 | #F44336 |

年龄段：6-8、9-11、12-14。任务难度系数：简单 ×1.0、中等 ×1.5、困难 ×2.0。

## 许可证

MIT
