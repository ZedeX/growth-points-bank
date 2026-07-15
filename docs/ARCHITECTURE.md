# 暑假成长积分银行 — 系统架构文档

> **版本**: v1.0
> **创建日期**: 2026-07-16
> **关联**: [PRD.md](./PRD.md) · [TDD_SPEC.md](./TDD_SPEC.md) · [ADR 索引](./architecture/)
> **状态**: Accepted

---

## 目录

1. [架构概述](#1-架构概述)
2. [C4 模型 - Level 1: System Context](#2-c4-模型---level-1-system-context)
3. [C4 模型 - Level 2: Container](#3-c4-模型---level-2-container)
4. [C4 模型 - Level 3: Component](#4-c4-模型---level-3-component)
5. [模块边界与依赖](#5-模块边界与依赖)
6. [数据流](#6-数据流)
7. [领域驱动设计边界](#7-领域驱动设计边界)
8. [跨切面关注](#8-跨切面关注)
9. [部署拓扑](#9-部署拓扑)
10. [技术决策索引](#10-技术决策索引)
11. [架构原则与约束](#11-架构原则与约束)
12. [风险与权衡](#12-风险与权衡)

---

## 1. 架构概述

### 1.1 设计目标

| 目标 | 量化指标 | 来源 |
|------|---------|------|
| 移动优先响应式 | 375-768px 适配 | PRD §7.1 |
| 首屏加载 | < 2s on 4G | PRD §7.2 |
| 打卡响应 | < 500ms p95 | PRD §7.2 |
| 积分完整性 | 0 lost-update incidents | ADR-0003 |
| 多租户隔离 | 0 跨家庭数据泄露 | ADR-0006 |
| 可用性 | 99.5% (MVP) | PRD §7.4 |
| 数据安全 | 字段级 AES-256-GCM 加密 | ADR-0009 |

### 1.2 架构风格

**分层 + 模块化单体**（modular monolith）：
- **前端**：React SPA + TanStack Query（server state 缓存）+ Zustand（UI state）
- **后端**：Fastify + Drizzle ORM，按领域模块组织代码（auth、family、tasks、checkins、points、rewards、redemptions、reviews、diaries）
- **数据库**：单一 PostgreSQL 实例，多租户通过 `family_id` 行级过滤

**为何不用微服务？** 单家庭规模、单开发者、MVP 阶段——微服务的运维与网络成本远超收益。模块化单体保留未来拆分可能性（每个领域模块独立、接口清晰）。

### 1.3 设计原则

1. **类型安全端到端**：Zod schema 在前后端共享，编译期消除类型错误
2. **单一可信源**：积分余额由 `point_transactions` 表推导，不维护 `balance` 列
3. **防御性纵深**：应用层校验 + DB CHECK 约束 + DB 触发器 + 字段级加密
4. **可观测优先**：结构化日志 + 审计日志 + 健康检查端点
5. **TDD 驱动**：测试接缝先行定义，代码只为通过测试而存在
6. **简单优于聪明**：用 `Record<Status, Set<Status>>` 表达状态机而非引入 XState；用 `node-cron` 而非 BullMQ

---

## 2. C4 模型 - Level 1: System Context

```
                    ┌─────────────────────────┐
                    │   家长 (Parent User)     │
                    │   手机/平板/PC 浏览器    │
                    └────────────┬────────────┘
                                 │ HTTPS
                                 │
                                 ▼
        ┌──────────────────────────────────────────────┐
        │     暑假成长积分银行 (Growth Points Bank)    │
        │                                              │
        │  · 家长端：管理任务/奖励/审核/数据看板     │
        │  · 孩子端：成长地图/打卡/兑换/复盘/日记    │
        │  · 双角色 JWT 认证（家长密码 + 孩子链接） │
        │  · 积分事务 SERIALIZABLE 隔离              │
        │  · 字段级 AES-256-GCM 加密儿童 PII        │
        └──────────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐
    │  孩子端用户     │  │  Postgres    │  │  GitHub Repo   │
    │  (扫码/链接)    │  │  (Neon)      │  │  (CI/CD 源)    │
    └─────────────────┘  └──────────────┘  └────────────────┘
```

### 外部系统交互

| 外部系统 | 交互方式 | 方向 | 数据 |
|---------|---------|------|------|
| 家长浏览器 | HTTPS + JSON API | 双向 | 任务/积分/兑换数据 |
| 孩子浏览器 | HTTPS + JSON API + httpOnly cookie | 双向 | 打卡/积分/兑换数据 |
| Neon Postgres | TLS + SQL | 出站 | 所有持久化数据 |
| GitHub Actions | webhook | 入站 | CI 触发 |
| Vercel/Railway/Neon | API + secrets | 出站 | 部署 |

---

## 3. C4 模型 - Level 2: Container

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  React 18 SPA                                                    │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │   │
│  │  │ TanStack Query  │  │ Zustand UI Store│  │ React Router 6 │   │   │
│  │  │ (Server State)  │  │ (UI State)      │  │ (URL State)    │   │   │
│  │  └────────┬────────┘  └─────────────────┘  └────────────────┘   │   │
│  │           │                                                       │   │
│  │  ┌────────▼──────────────────────────────────────────────────┐    │   │
│  │  │ Tailwind CSS + shadcn/ui 组件库                          │    │   │
│  │  └─────────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ HTTPS /api/* JSON
                                  │ Authorization: Bearer <jwt>
                                  │ 或 child_session cookie
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Vercel Edge / CDN                                  │
│  · 静态资源 (HTML/JS/CSS/图片)                                          │
│  · Brotli 压缩                                                          │
│  · /api/* 反向代理到 Railway 后端                                      │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  Backend Container (Railway)                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Fastify 4 (Node.js 20 LTS)                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │ │
│  │  │  Routes      │  │  Middleware  │  │  Services              │   │ │
│  │  │  /api/auth   │→ │  auth()      │→ │  recordPointsTx()    │   │ │
│  │  │  /api/tasks  │  │  tenant()   │  │  approveRedemption() │   │ │
│  │  │  /api/checkins│  │  ratelimit()│  │  getDimensionStatus()│   │ │
│  │  │  /api/points │  │  logger()    │  │  ...                 │   │ │
│  │  │  /api/rewards│  └──────────────┘  └─────────────────────┘   │ │
│  │  │  /api/redemptions                                          │   │ │
│  │  │  /api/children /api/family                                 │   │ │
│  │  └──────────────────────────────────────────────────────────────┘ │
│  │                                                                    │
│  │  ┌────────────────────────────────────────────────────────────┐   │
│  │  │  Repositories (Drizzle ORM)                                │   │
│  │  │  taskRepo · childRepo · checkinRepo · pointRepo           │   │
│  │  │  rewardRepo · redemptionRepo · reviewRepo · diaryRepo     │   │
│  │  └────────────────────────────────────────────────────────────┘   │
│  │                                                                    │
│  │  ┌────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  │ Field Encryption Layer│  │ Cron Scheduler (node-cron)       │  │
│  │  │ AES-256-GCM            │  │ · weekly-review-reminder (Sun)  │  │
│  │  │ (crypto module)        │  │ · fulfillment-reminder (daily)   │  │
│  │  └────────────────────────┘  └─────────────────────────────────┘  │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────┐                                                 │
│  │ Local FS /data/avatars│  (持久卷)                                     │
│  └─────────────────────┘                                                 │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ TLS + connection pool
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  Neon Postgres 16 (Database)                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Schema: app                                                                                                       │   │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐   │   │
│  │  │ families   │ │ parents  │ │ children │ │ dimensions      │   │   │
│  │  ├────────────┤ ├──────────┤ ├──────────┤ ├─────────────────┤   │   │
│  │  │ tasks      │ │ checkins │ │ rewards  │ │ reward_redemptions│  │   │
│  │  ├────────────┤ ├──────────┤ ├──────────┤ ├─────────────────┤   │   │
│  │  │point_tx    │ │weekly_rev│ │growth_dia│ │ notifications    │   │   │
│  │  └────────────┘ └──────────┘ └──────────┘ └─────────────────┘   │   │
│  │                                                                  │   │
│  │  约束: CHECK · UNIQUE · FK · 触发器 (redemption_transition)    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 容器清单

| 容器 | 技术 | 职责 | ADR |
|------|------|------|-----|
| Browser SPA | React 18 + Vite + Tailwind | 渲染 UI，管理 server/UI state | ADR-0001, ADR-0007 |
| Vercel Edge | Vercel CDN | 静态分发 + API 代理 | ADR-0008 |
| Backend | Fastify 4 + Drizzle + node-cron | 业务逻辑、API、调度 | ADR-0001, ADR-0010 |
| Database | PostgreSQL 16 (Neon) | 持久化 + 事务 + 约束 | ADR-0003, ADR-0006, ADR-0009 |
| Local FS | Railway 持久卷 | 头像文件存储 | ADR-0008 |
| GitHub Actions | CI | lint/typecheck/test/build/deploy | ADR-0008 |

---

## 4. C4 模型 - Level 3: Component

### 4.1 前端组件图

```
┌─────────────────────────────────────────────────────────────────┐
│                       React SPA                                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pages (React Router)                                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   │
│  │  │ ParentPages  │  │ ChildPages   │  │ AuthPages    │     │   │
│  │  │ - /parent    │  │ - /child/map │  │ - /login     │     │   │
│  │  │ - /tasks     │  │ - /checkin   │  │ - /register │     │   │
│  │  │ - /rewards   │  │ - /points    │  │ - /child/auth│     │   │
│  │  │ - /dashboard │  │ - /rewards   │  └──────────────┘     │   │
│  │  │ - /review    │  │ - /diary     │                       │   │
│  │  │ - /diary     │  │ - /review    │                       │   │
│  │  └──────────────┘  └──────────────┘                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Feature Components                                      │   │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │   │
│  │  │<GrowthMap> │ │<TaskCard>│ │<CheckInP>│ │<RewardCrd>│   │   │
│  │  └────────────┘ └──────────┘ └──────────┘ └──────────┘    │   │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │   │
│  │  │<Redemption>│ │<PointsBl>│ │<DimCard> │ │<DiaryCard>│   │   │
│  │  └────────────┘ └──────────┘ └──────────┘ └──────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Data Layer                                              │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌────────────────┐   │   │
│  │  │ api/ client  │  │ TanStack    │  │ Zustand stores │   │   │
│  │  │ (fetch)      │  │ Query hooks │  │ (UI state)      │   │   │
│  │  └──────────────┘  └─────────────┘  └────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Shared                                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐    │   │
│  │  │ types/   │  │ schemas/ │  │ utils/   │  │ constants│   │   │
│  │  │ (TS types│  │ (Zod)    │  │          │  │          │   │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 后端组件图

```
┌────────────────────────────────────────────────────────────────────┐
│                       Fastify Backend                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Plugins (注册顺序)                                          │   │
│  │  ┌────────┐ → ┌──────────┐ → ┌──────────┐ → ┌──────────┐    │   │
│  │  │ cors() │   │ helmet() │   │ rateLimit│  │ auth()   │    │   │
│  │  └────────┘   └──────────┘   └──────────┘  └──────────┘    │   │
│  │                                                              │   │
│  │  ┌────────┐ → ┌──────────┐ → ┌──────────┐                   │   │
│  │  │ logger│   │ tenant() │   │ routes() │                   │   │
│  │  └────────┘   └──────────┘   └──────────┘                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Routes (按领域模块组织)                                     │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │ /auth       │  │ /family     │  │ /children   │           │   │
│  │  │ - register  │  │ - get       │  │ - create    │           │   │
│  │  │ - login     │  │ - update    │  │ - list      │           │   │
│  │  │ - refresh   │  │             │  │ - delete    │           │   │
│  │  │             │  │             │  │ - access-tok│           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │ /tasks      │  │ /checkins   │  │ /points     │           │   │
│  │  │ - CRUD      │  │ - create    │  │ - balance   │           │   │
│  │  │ - list      │  │ - delete    │  │ - transact  │           │   │
│  │  │             │  │ - revoke    │  │             │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │ /rewards    │  │ /redemptions│  │ /reviews    │           │   │
│  │  │ - CRUD      │  │ - create    │  │ - get       │           │   │
│  │  │             │  │ - approve   │  │ - submit    │           │   │
│  │  │             │  │ - reject    │  │ - list      │           │   │
│  │  │             │  │ - fulfill   │  │             │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Services (业务逻辑)                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │ authService  │  │ pointsService│  │ redemptionService│  │   │
│  │  │ - register   │  │ - recordTx   │  │ - approve        │  │   │
│  │  │ - login      │  │ - getBalance │  │ - reject         │  │   │
│  │  │ - issueToken │  │ - getHistory │  │ - fulfill        │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │ taskService  │  │ reviewService│  │ notificationSvc  │  │   │
│  │  │ - CRUD       │  │ - submit     │  │ - send           │  │   │
│  │  │ - visibility │  │ - getReview  │  │ - list           │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Domain (纯函数，无 IO)                                     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │   │
│  │  │ calculatePoints │  │ getDimensionStat│                   │   │
│  │  │ canRedeem       │  │ canCheckIn      │                   │   │
│  │  │ getVisibleTasks │  │ canTransition   │                   │   │
│  │  └─────────────────┘  └─────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Infrastructure                                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │   │
│  │  │ DrizzleDB│  │ crypto/  │  │ jobs/    │  │ utils/     │  │   │
│  │  │ (conn pool)│  │ field-enc│  │ scheduler│  │ logger     │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. 模块边界与依赖

### 5.1 依赖方向（单向，从外到内）

```
┌──────────────────────────────────────────────────────┐
│  Routes (HTTP 接缝)                                │
│  ↓                                                  │
│  Services (业务逻辑编排，事务边界)                 │
│  ↓                                                  │
│  Domain (纯函数，可独立测试)                       │
│  ↓                                                  │
│  Repositories (数据访问，tenant scope)             │
│  ↓                                                  │
│  Infrastructure (DB, crypto, scheduler, fs)        │
└──────────────────────────────────────────────────────┘

依赖规则：
- Routes → Services → Domain
- Services → Repositories (for persistence)
- Services → Domain (for business rules)
- Repositories → Infrastructure
- Domain ← (无依赖，纯函数)

禁止：
- Domain 不能 import Services/Routes/Infrastructure
- Routes 不能直接 import Repositories（必须经过 Services）
- Repositories 不能 import Routes/Services（避免循环）
```

### 5.2 领域模块清单

| 模块 | 路径 | 职责 | 主要实体 |
|------|------|------|---------|
| auth | `src/server/modules/auth/` | 注册/登录/JWT 签发/Token 刷新 | Parent, Child |
| family | `src/server/modules/family/` | 家庭信息 CRUD，暑假日期设置 | Family |
| children | `src/server/modules/children/` | 孩子档案 CRUD，访问令牌生成 | Child |
| tasks | `src/server/modules/tasks/` | 任务 CRUD，可见性计算 | Task, Dimension |
| checkins | `src/server/modules/checkins/` | 打卡/取消/家长撤销 | CheckIn |
| points | `src/server/modules/points/` | 积分事务/余额/流水 | PointTransaction |
| rewards | `src/server/modules/rewards/` | 奖励 CRUD | Reward |
| redemptions | `src/server/modules/redemptions/` | 兑换请求/审核/履约 | RewardRedemption |
| reviews | `src/server/modules/reviews/` | 每周复盘双盲提交/锁定 | WeeklyReview |
| diaries | `src/server/modules/diaries/` | 成长日记 CRUD | GrowthDiary |
| notifications | `src/server/modules/notifications/` | 通知存储（MVP 内置）/推送（Phase 2） | Notification |

每个模块内部结构：

```
src/server/modules/<module>/
├── routes.ts          # Fastify route definitions
├── service.ts         # Business logic
├── repository.ts      # Data access (tenant-scoped)
├── schemas.ts         # Zod request/response schemas
└── __tests__/
    ├── service.test.ts
    └── routes.test.ts
```

---

## 6. 数据流

### 6.1 打卡流程（核心高频路径）

```
孩子点击"完成"按钮
  ↓
前端 TanStack Query mutation
  ↓ optimistic update: 临时显示已完成
  ↓
POST /api/checkins { task_id, date: "2026-07-16" }
  ↓ Authorization: Bearer <child_jwt>
  ↓
[Vercel] → 反向代理 →
[Railway Backend]
  ↓
auth.preHandler: 验证 JWT → request.auth = { role: "child", sub, family_id }
  ↓
tenant.preHandler: request.childId = sub, request.familyId = family_id
  ↓
checkins.routes POST /api/checkins
  ↓
checkins.service.checkIn(familyId, childId, taskId, date)
  ↓
┌─ DB TRANSACTION (SERIALIZABLE) ──────────────────────────────┐
│  1. SELECT task FROM tasks WHERE id=? AND family_id=?        │
│     - 验证任务存在、属于该家庭、is_active=true               │
│  2. SELECT checkin FROM checkins WHERE child_id=?             │
│     AND task_id=? AND date=? AND revoked_by_parent=false      │
│     - 若已存在 → 抛 409 Conflict                              │
│  3. INSERT INTO checkins (child_id, task_id, date)            │
│  4. SELECT MAX(balance_after) FROM point_transactions         │
│     WHERE child_id=? → currentBalance                         │
│  5. INSERT INTO point_transactions                            │
│     (child_id, amount=+task.point_value, source_type='task', │
│      source_id=checkin.id, balance_after=currentBalance+amt)  │
│  6. RETURN balance_after                                      │
└───────────────────────────────────────────────────────────────┘
  ↓
返回 201 { id, points_earned, balance_after }
  ↓
前端 invalidateQueries(['checkins', 'today', childId])
前端 invalidateQueries(['points', 'balance', childId])
  ↓
重新 GET /api/checkins/today + GET /api/points/balance
  ↓
UI 显示最新余额 + 打卡状态
```

### 6.2 兑换审核流程

```
家长在 /parent/redemptions 点击"通过"
  ↓
PATCH /api/redemptions/:id/approve { parent_note }
  ↓
auth.preHandler: 验证 parent JWT
  ↓
redemptions.routes PATCH /api/redemptions/:id/approve
  ↓
redemptions.service.approveRedemption(redemptionId, parentNote)
  ↓
┌─ DB TRANSACTION (SERIALIZABLE) ──────────────────────────────┐
│  1. SELECT rr FROM reward_redemptions WHERE id=? FOR UPDATE  │
│     - 验证 status='pending'，否则抛 400                       │
│     - assertCanTransition('pending', 'approved')             │
│  2. UPDATE reward_redemptions SET status='approved',          │
│     reviewed_at=NOW(), parent_note=? WHERE id=?               │
│  3. recordPointsTx(child_id, -point_cost, 'reward', rr.id)    │
│     - SELECT MAX(balance_after) → current                    │
│     - 若 current - point_cost < 0 → 抛 INSUFFICIENT_BALANCE   │
│     - INSERT INTO point_transactions (amount=-point_cost,    │
│       balance_after=current-point_cost)                       │
│  4. RETURN balance_after                                      │
└───────────────────────────────────────────────────────────────┘
  ↓
返回 200 { status: "approved", balance_after }
  ↓
前端 invalidateQueries(['redemptions'], ['points/balance'])
  ↓
家长端显示"已批准" + 新余额
孩子端下次进入看到"待履约"
```

### 6.3 每周复盘双盲提交流程

```
孩子周日 18:00 收到通知
  ↓
进入 /child/review?week=2026-07-13
  ↓
GET /api/reviews?week_start=2026-07-13
  ↓
reviews.service.getReview(childId, '2026-07-13', 'child')
  ↓
检查 child_committed_at / parent_committed_at / locked_at
  ↓
返回: { best_thing: "...", difficulty: "...", child_request: null,
         other: { status: "other_not_started" },
         self_committed: false, locked: false }
  ↓
孩子填写并提交
  ↓
POST /api/reviews { week_start: "2026-07-13",
                    best_thing, difficulty, child_request }
  ↓
reviews.service.submitChildReview(childId, weekStart, fields)
  ↓
┌─ DB TRANSACTION ─────────────────────────────────────────────┐
│  1. SELECT wr FOR UPDATE WHERE child_id=? AND week_start=?   │
│  2. 检查 locked_at IS NULL（若已锁定 → 409）                  │
│  3. UPDATE wr SET best_thing=?, difficulty=?, child_request=?,│
│     child_committed_at=NOW() WHERE id=?                       │
│  4. IF parent_committed_at IS NOT NULL:                     │
│       UPDATE wr SET locked_at=NOW()                          │
│       计算 task_count / point_earned / dimension_count 并写入│
└───────────────────────────────────────────────────────────────┘
  ↓
返回 200 { status: "submitted", locked: <true|false> }
  ↓
孩子下次 GET 看到自己的内容 + other.status = "other_committed_waiting_for_you"
  （或如果家长已提交且锁定，则看到家长内容）
```

---

## 7. 领域驱动设计边界

### 7.1 限界上下文（Bounded Contexts）

```
┌───────────────────────────────────────────────────────────────┐
│                  Identity & Access Context                   │
│  ──────────────────────────────────────────                  │
│  Parent, Child, Family, AuthToken                            │
│  通用语言: register, login, issue token, revoke              │
│  入口: /api/auth, /api/children (token generation)           │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Task Management Context                            │    │
│  │  ─────────────────────────                         │    │
│  │  Task, Dimension, Frequency                        │    │
│  │  通用语言: create, activate, get visible tasks     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Check-in Context                                   │    │
│  │  ─────────────────────────                         │    │
│  │  CheckIn, revocation                                │    │
│  │  通用语言: check in, cancel, revoke, audit          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Points Context (核心)                              │    │
│  │  ─────────────────────────                         │    │
│  │  PointTransaction, balance                          │    │
│  │  通用语言: earn, spend, balance, audit             │    │
│  │  ⚠️ 跨上下文集成点: 被 Check-in / Redemption 调用   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Reward & Redemption Context                        │    │
│  │  ─────────────────────────                         │    │
│  │  Reward, RewardRedemption, state machine           │    │
│  │  通用语言: create reward, request, approve, reject,│    │
│  │           fulfill, expire                           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Weekly Review Context (双盲)                       │    │
│  │  ─────────────────────────                         │    │
│  │  WeeklyReview, commitment, lock                     │    │
│  │  通用语言: draft, commit, lock, reveal             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Growth Diary Context                               │    │
│  │  ─────────────────────────                         │    │
│  │  GrowthDiary, category                              │    │
│  │  通用语言: write, list, filter, archive             │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

### 7.2 上下文映射（Context Map）

| 调用方 | 被调用方 | 关系类型 | 集成方式 |
|--------|---------|---------|---------|
| Check-in | Points | Customer/Supplier | 同事务：checkin service 调用 `recordPointsTx` |
| Redemption | Points | Customer/Supplier | 同事务：redemption service 调用 `recordPointsTx` |
| Check-in | Task | Conformist | 查询 task 验证存在性（只读） |
| Weekly Review | Check-in, Points | Conformist | 锁定时聚合本周数据（只读） |
| Redemption | Reward | Conformist | 查询 reward 验证 + 快照 point_cost |
| Auth | Family, Child | Customer/Supplier | 签发 token 时查询 family/child |
| 所有 | Notifications | Open Host Service | 通过 `sendNotification()` 接口 |

### 7.3 实体聚合根

| 聚合根 | 包含实体 | 不变量 |
|--------|---------|--------|
| Family | Parent (1:1) | 一个 parent 对应一个 family |
| Child | (无内嵌实体) | access_token 唯一；token_version 单调递增 |
| Task | (无内嵌实体) | dimension_id ∈ 预置维度；point_value ∈ [1,20] |
| CheckIn | (无内嵌实体) | UNIQUE(child_id, task_id, date)；revoked 状态不可逆 |
| PointTransaction | (无内嵌实体) | amount ≠ 0；balance_after = MAX(prev) + amount ≥ 0 |
| RewardRedemption | (无内嵌实体) | state machine 约束；point_cost 快照不可变 |
| WeeklyReview | (无内嵌实体) | CHECK 约束保证提交状态一致性 |
| GrowthDiary | (无内嵌实体) | child_id 不可变；category ∈ enum |

---

## 8. 跨切面关注

### 8.1 认证与授权

| 端点类型 | 角色 | 中间件链 |
|---------|------|---------|
| `POST /api/auth/*` | 公开 | cors, rateLimit, logger |
| `GET /api/family`, `/api/children/*` | parent | cors, auth, requireParent |
| `POST /api/tasks` etc. | parent | cors, auth, requireParent |
| `GET /api/checkins/today` | child | cors, auth, requireChild |
| `POST /api/checkins` | child | cors, auth, requireChild, rateLimit(per-child) |
| `POST /api/redemptions` | child | cors, auth, requireChild |
| `PATCH /api/redemptions/:id/approve` | parent | cors, auth, requireParent |
| `POST /api/reviews/child` | child | cors, auth, requireChild |
| `POST /api/reviews/parent` | parent | cors, auth, requireParent |

### 8.2 错误处理

统一错误信封：

```typescript
{
  error: {
    code: "INSUFFICIENT_BALANCE" | "FORBIDDEN" | "NOT_FOUND" | ...,
    message: "人类可读说明",
    details?: { ... }  // 可选字段错误细节
  }
}
```

| HTTP | code | 场景 |
|------|------|------|
| 400 | VALIDATION_ERROR | Zod schema 校验失败 |
| 400 | INSUFFICIENT_BALANCE | 兑换积分不足 |
| 400 | INVALID_TRANSITION | 兑换状态机非法转换 |
| 400 | CHECKIN_PAST_DATE | 不可补打卡 |
| 401 | UNAUTHORIZED | 缺失/无效 token |
| 403 | FORBIDDEN | 角色不匹配 |
| 404 | NOT_FOUND | 资源不存在或跨家庭访问 |
| 409 | CONFLICT | 重复打卡 / 复盘已锁定 |
| 422 | UNPROCESSABLE_ENTITY | 业务规则违反 |
| 429 | RATE_LIMITED | 超频 |
| 500 | INTERNAL_ERROR | 未捕获异常 |

### 8.3 日志规范

结构化 JSON 日志（pino）：

```json
{
  "level": "info",
  "time": "2026-07-16T10:00:00.000Z",
  "requestId": "uuid",
  "method": "POST",
  "url": "/api/checkins",
  "statusCode": 201,
  "durationMs": 42,
  "auth": { "role": "child", "sub": "uuid-redacted", "family_id": "uuid-redacted" },
  "message": "request completed"
}
```

**日志脱敏**：禁止打印 PII 字段（name, avatar, diary_content）；使用 `redact` 配置：

```typescript
const logger = pino({
  redact: {
    paths: ['*.name', '*.avatar', '*.best_thing', '*.difficulty', '*.parent_observation', '*.child_request', '*.title', '*.content'],
    remove: false,  // 替换为 [Redacted] 而非移除字段
  },
});
```

### 8.4 监控指标

| 指标 | 类型 | 告警阈值 |
|------|------|---------|
| `http_requests_total{route,status}` | counter | - |
| `http_request_duration_seconds{route}` | histogram | p95 > 500ms for /api/checkins |
| `db_transaction_duration_seconds` | histogram | p95 > 100ms |
| `cron_job_success_total{job}` | counter | 失败率 > 10% |
| `serialization_retry_total` | counter | > 10/min |
| `failed_login_attempts_total{ip}` | counter | > 5/15min |

### 8.5 配置管理

环境变量清单（参见 ADR-0008）：

```bash
# 数据库
DATABASE_URL=postgres://...
DATABASE_POOL_MAX=10

# JWT 密钥
PARENT_JWT_SECRET=<32+ chars>
CHILD_JWT_SECRET=<32+ chars>

# 字段加密
DATA_ENCRYPTION_KEY=<32 bytes base64>

# 调度
ENABLE_SCHEDULER=true
TZ=Asia/Shanghai

# 部署
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://app.growth-points-bank.example.com
```

### 8.6 安全头

```typescript
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind 需要
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://api.growth-points-bank.example.com"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
});
```

---

## 9. 部署拓扑

### 9.1 环境矩阵

| 环境 | 前端 | 后端 | 数据库 | 调度 |
|------|------|------|--------|------|
| Local | Vite dev (5173) | Fastify dev (3000) | Docker postgres:16 | 关闭 |
| Preview (PR) | Vercel preview URL | Railway preview | Neon preview branch | 关闭 |
| Production | Vercel prod | Railway prod | Neon main branch | 开启 |

### 9.2 数据库迁移流程

```
开发阶段：
  1. 修改 src/server/db/schema.ts
  2. pnpm db:generate  → 生成 SQL migration 文件 in drizzle/
  3. pnpm db:migrate    → 应用到本地 DB
  4. git commit -m "schema: ..." (含 migration 文件)

部署阶段（CI 自动）：
  1. GitHub Actions 触发 Railway deploy
  2. Railway 启动时执行：pnpm db:migrate
  3. 失败回滚：Railway 自动保留前一版本
  4. Drizzle 在 drizzle_migrations 表中记录版本
```

### 9.3 备份与恢复

| 数据 | 备份策略 | 恢复时间目标 |
|------|---------|-------------|
| Postgres | Neon 自动持续 + 7 天 PITR (free tier) | < 5 min |
| Avatars (local FS) | 无备份（可重建） | N/A |
| 环境变量/secrets | Railway + Vercel 控制台 | < 5 min |
| 代码 | Git + GitHub | < 1 min |

### 9.4 健康检查

```
GET /api/health
{
  "status": "ok",
  "uptime": 3600,
  "db": "ok",
  "version": "1.0.0",
  "commitSha": "abc1234"
}
```

Railway 探针：每 30s 调用 `/api/health`，连续 3 次失败触发重启。

---

## 10. 技术决策索引

| ADR | 标题 | 状态 | 阻塞 |
|-----|------|------|------|
| [ADR-0001](./architecture/adr-0001-tech-stack.md) | Tech Stack Selection | Accepted | 所有 epic |
| [ADR-0002](./architecture/adr-0002-authentication.md) | Dual JWT Authentication | Accepted | Auth & Family Account |
| [ADR-0003](./architecture/adr-0003-points-integrity.md) | Points Transaction Integrity | Accepted | Check-in, Points, Redemption |
| [ADR-0004](./architecture/adr-0004-redemption-state-machine.md) | Reward Redemption State Machine | Accepted | Reward Redemption |
| [ADR-0005](./architecture/adr-0005-double-blind-review.md) | Weekly Review Double-Blind | Accepted | Weekly Review (Phase 2) |
| [ADR-0006](./architecture/adr-0006-multi-tenant-isolation.md) | Multi-Tenant Data Isolation | Accepted | All data epics |
| [ADR-0007](./architecture/adr-0007-frontend-state.md) | Frontend State Management | Accepted | Frontend Components |
| [ADR-0008](./architecture/adr-0008-deployment-topology.md) | Deployment Topology | Accepted | CI/CD setup |
| [ADR-0009](./architecture/adr-0009-data-encryption.md) | Child Data Encryption at Rest | Accepted | Data persistence |
| [ADR-0010](./architecture/adr-0010-background-jobs.md) | Background Jobs (node-cron) | Accepted | Weekly Review, Redemption |

---

## 11. 架构原则与约束

### 11.1 必须做（Mandatory）

1. **每个 tenant-scoped 查询必须** filter by `family_id`（ADR-0006）
2. **每个积分变动必须** 走 `recordPointsTx` 在 SERIALIZABLE 事务内（ADR-0003）
3. **每次状态转换必须** 通过 `assertCanTransition` 校验（ADR-0004）
4. **每个 PII 字段写入必须** 通过 `encryptField` 加密（ADR-0009）
5. **每个 API 端点必须** 显式声明 `preHandler` 链（auth + tenant + role）
6. **每个 commit 必须通过** lint + typecheck + unit + integration 测试
7. **每个 schema 变更必须** 通过 Drizzle migration，不允许手改 DB

### 11.2 禁止做（Forbidden）

1. ❌ 直接构造 SQL 字符串拼接（必须用 Drizzle 参数化）
2. ❌ 在 Domain 层 import Services/Routes/Infrastructure
3. ❌ 在日志中打印 PII 字段（name/avatar/diary content）
4. ❌ 使用 `SELECT *` （显式列出列名）
5. ❌ 在事务中执行网络/IO 操作（保持 < 50ms）
6. ❌ 创建不通过 repository 的数据访问路径
7. ❌ 使用 localStorage 存储敏感 token（用 httpOnly cookie 或 sessionStorage）
8. ❌ 在前端硬编码 API URL（使用 `VITE_API_BASE_URL` env var）
9. ❌ 跳过 Zod schema 验证（所有请求/响应都要验证）
10. ❌ 创建不带 `family_id` 的查询（除非显式 admin/system 端点）

### 11.3 控制清单（Code Review Checklist）

代码审查时检查：

- [ ] 新查询是否过滤 `family_id`？
- [ ] 新 schema 是否包含必要 CHECK / UNIQUE 约束？
- [ ] 新 API 端点是否声明 `preHandler` 链？
- [ ] 新 PII 字段是否使用 `encryptedText` 类型？
- [ ] 新状态机转换是否在 `REDEMPTION_TRANSITIONS` 中？
- [ ] 新后台任务是否在 `startScheduler()` 中注册？
- [ ] 新的 Zod schema 是否在 `packages/shared` 中（前后端共享）？
- [ ] 新的错误是否使用标准错误信封？
- [ ] 新组件是否有相应的测试（unit/integration/component）？
- [ ] 新的依赖是否在 `package.json` 中（不在 lockfile 外）？

---

## 12. 风险与权衡

### 12.1 已知风险

| ID | 风险 | 影响 | 概率 | 缓解 |
|----|------|------|------|------|
| R1 | 后端重启时调度任务丢失 | 提醒漏发 | 中 | 任务幂等；下次调度补齐；admin 手动触发 |
| R2 | Neon 免费层连接限制 | 高峰时连接失败 | 低 | 连接池；max=10；监控连接数 |
| R3 | Railway 实例多副本时调度重复执行 | 双重通知 | 低 | `ENABLE_SCHEDULER` 仅主实例；advisory lock（如多副本） |
| R4 | Argon2 CPU 占用 | 登录延迟 | 低 | `timeCost=2`；性能测试 |
| R5 | 字段加密增加复杂度 | 开发效率降低 | 中 | 仓库层抽象；TDD 测试覆盖 |
| R6 | SERIALIZABLE 隔离重试风暴 | 高并发下重试失败 | 低 | `withSerializableRetry` 线性退避；MVP 单家庭无并发 |
| R7 | Vercel 代理到 Railway 冷启动延迟 | API 延迟 | 中 | Railway Hobby 保持实例热；< 100ms 冷启动 |
| R8 | GBK 编码破坏 SQL | 数据损坏 | 中 | 强制 UTF-8；CI 测试 |
| R9 | Child token 泄露（分享链接） | 越权访问 | 中 | 7 天过期；家长可撤销；token_version |
| R10 | 字段加密 key 丢失 | 数据不可解密 | 低 | 备份密钥到密码管理器；rotation script 测试 |

### 12.2 接受的权衡

| 权衡 | 选择 | 放弃 |
|------|------|------|
| 简单 vs 分布式 | 单进程 node-cron | BullMQ + Redis 的高可用/可观测性 |
| 类型安全 vs 灵活 | 端到端 TypeScript + Zod | Python 的快速原型 |
| 防御纵深 vs 性能 | 字段级 AES-256-GCM | ~0.5ms 每字段的开销 |
| 多租户隔离 vs 复杂 | 应用层 family_id 过滤 | Postgres RLS 的 DB 级保障（MVP 后期可加） |
| 双盲真盲 vs 简单 | 应用层访问控制 + 审计日志 | 字段级 XOR 密钥分片（Phase 2 可加） |
| 部署简单 vs 控制 | Vercel + Railway + Neon | 自建 VPS 的完全控制 |
| 事务一致性 vs 可用性 | Postgres SERIALIZABLE | 高可用最终一致性 |

---

## 附录

### A. 技术栈版本清单

```json
{
  "frontend": {
    "react": "18.3.x",
    "typescript": "5.4.x",
    "vite": "5.2.x",
    "react-router": "6.23.x",
    "tanstack-query": "5.40.x",
    "zustand": "4.5.x",
    "tailwindcss": "3.4.x",
    "react-hook-form": "7.51.x",
    "zod": "3.23.x"
  },
  "backend": {
    "node": "20.x LTS",
    "fastify": "4.27.x",
    "drizzle-orm": "0.30.x",
    "drizzle-kit": "0.21.x",
    "jose": "5.3.x",
    "argon2": "0.40.x",
    "node-cron": "3.0.x",
    "pino": "9.1.x"
  },
  "testing": {
    "vitest": "1.6.x",
    "@testing-library/react": "15.x",
    "supertest": "7.0.x",
    "msw": "2.3.x",
    "playwright": "1.44.x",
    "@electric-sql/pglite": "0.1.x"
  },
  "tooling": {
    "pnpm": "9.x",
    "eslint": "9.x",
    "prettier": "3.x",
    "husky": "9.x",
    "lint-staged": "15.x"
  }
}
```

### B. 项目目录结构

```
growth-points-bank/
├── apps/
│   ├── web/                          # React SPA (Vercel)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── queries/
│   │   │   ├── stores/
│   │   │   ├── api/
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                          # Fastify Backend (Railway)
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── family/
│       │   │   ├── children/
│       │   │   ├── tasks/
│       │   │   ├── checkins/
│       │   │   ├── points/
│       │   │   ├── rewards/
│       │   │   ├── redemptions/
│       │   │   ├── reviews/
│       │   │   ├── diaries/
│       │   │   └── notifications/
│       │   ├── db/
│       │   │   ├── schema.ts
│       │   │   ├── client.ts
│       │   │   └── migrations/
│       │   ├── crypto/
│       │   │   └── field-crypto.ts
│       │   ├── jobs/
│       │   │   ├── scheduler.ts
│       │   │   ├── weekly-review-reminder.ts
│       │   │   └── fulfillment-reminder.ts
│       │   ├── middleware/
│       │   │   ├── auth.ts
│       │   │   ├── tenant.ts
│       │   │   └── rate-limit.ts
│       │   ├── utils/
│       │   │   ├── logger.ts
│       │   │   └── errors.ts
│       │   └── index.ts
│       ├── drizzle.config.ts
│       └── package.json
│
├── packages/
│   └── shared/                       # 共享类型 + Zod schemas
│       ├── src/
│       │   ├── schemas/
│       │   ├── types/
│       │   └── domain/                # 纯函数领域逻辑
│       │       ├── points.ts
│       │       ├── dimensions.ts
│       │       ├── tasks.ts
│       │       ├── checkin.ts
│       │       ├── rewards.ts
│       │       └── redemption-state.ts
│       └── package.json
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── component/
│   ├── e2e/
│   └── fixtures/
│
├── docs/
│   ├── PRD.md
│   ├── TDD_SPEC.md
│   ├── ARCHITECTURE.md               # ← 本文档
│   ├── API.md
│   ├── DETAILED_DESIGN.md
│   └── architecture/
│       ├── adr-0001-tech-stack.md
│       ├── adr-0002-authentication.md
│       ├── adr-0003-points-integrity.md
│       ├── adr-0004-redemption-state-machine.md
│       ├── adr-0005-double-blind-review.md
│       ├── adr-0006-multi-tenant-isolation.md
│       ├── adr-0007-frontend-state.md
│       ├── adr-0008-deployment-topology.md
│       ├── adr-0009-data-encryption.md
│       └── adr-0010-background-jobs.md
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
│
├── package.json                       # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```
