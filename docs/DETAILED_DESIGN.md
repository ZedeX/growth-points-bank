# 暑假成长积分银行 — 详细设计文档

> **版本**: v1.0
> **创建日期**: 2026-07-16
> **关联**: [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [API.md](./API.md) · [TDD_SPEC.md](./TDD_SPEC.md)

---

## 目录

1. [领域模型](#1-领域模型)
2. [状态机](#2-状态机)
3. [核心时序图](#3-核心时序图)
4. [关键算法](#4-关键算法)
5. [数据完整性约束](#5-数据完整性约束)
6. [安全设计](#6-安全设计)
7. [并发控制](#7-并发控制)
8. [性能设计](#8-性能设计)
9. [可观测性设计](#9-可观测性设计)
10. [错误处理与重试](#10-错误处理与重试)
11. [数据库 Schema 完整定义](#11-数据库-schema-完整定义)
12. [关键代码骨架](#12-关键代码骨架)

---

## 1. 领域模型

### 1.1 实体关系图（ER Diagram）

```
┌─────────────┐         ┌──────────────┐
│   Family    │1───1───1│   Parent     │
│             │         │              │
│ id (PK)     │         │ id (PK)      │
│ name        │         │ email        │
│ summer_start│         │ phone        │
│ summer_end  │         │ password_hash│
│ review_time │         │ family_id(FK)│
│ achievement │         └──────────────┘
│ created_at  │
└──────┬──────┘
       │1
       │
       │n
┌──────▼──────┐         ┌──────────────┐
│   Child     │1───n───1│  Dimension   │
│             │         │ (预置1-5)    │
│ id (PK)     │         │              │
│ family_id(FK)│        │ id (PK)      │
│ name        │         │ name         │
│ avatar      │         │ icon         │
│ age_group   │         │ color        │
│ access_token│         │ sort_order   │
│ token_ver   │         └──────────────┘
│ token_exp   │                │1
└──────┬──────┘                │
       │1                      │n
       │                ┌──────▼──────┐
       │n               │   Task      │
       │                │             │
       │                │ id (PK)     │
       │            ┌───│ family_id(FK)│
       │            │   │ dimension_id│
       │            │   │ title       │
       │            │   │ point_value │
       │            │   │ frequency   │
       │            │   │ is_active   │
       │            │   └─────────────┘
       │            │          │1
       │            │          │
       │            │          │n
       │       ┌────▼──────────▼───┐
       │       │     CheckIn       │
       │       │                   │
       │       │ id (PK)           │
       ├──────n│ child_id (FK)     │
       │       │ task_id (FK)      │
       │       │ date              │
       │       │ revoked_by_parent │
       │       │ revoked_at        │
       │       └───────────────────┘
       │
       │n
┌──────▼──────────┐  ┌──────────────┐
│ PointTransaction │  │    Reward    │
│                 │  │              │
│ id (PK)         │  │ id (PK)      │
│ child_id (FK)   │  │ family_id(FK)│
│ amount          │  │ tier         │
│ source_type     │  │ point_cost  │
│ source_id       │  │ title        │
│ balance_after   │  │ description │
│ created_at      │  │ is_active   │
└─────────────────┘  └──────┬───────┘
                          │1
                          │
                          │n
                  ┌───────▼─────────┐
                  │ RewardRedemption │
                  │                 │
                  │ id (PK)         │
                  │ child_id (FK)   │
                  │ reward_id (FK)  │
                  │ point_cost (快照)│
                  │ status          │
                  │ child_note      │
                  │ parent_note     │
                  │ reviewed_at     │
                  │ fulfilled_at    │
                  │ last_reminder   │
                  └─────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ WeeklyReview │    │ GrowthDiary │    │ Notification│
└──────────────┘    └──────────────┘    └──────────────┘
   (Phase 2)         (Phase 2)         (MVP simple)
```

### 1.2 领域服务

| 服务 | 主要方法 | 调用关系 |
|------|---------|---------|
| `AuthService` | `register()`, `login()`, `verifyToken()`, `issueParentJWT()`, `issueChildJWT()` | 调 ParentRepo, ChildRepo |
| `ChildService` | `create()`, `update()`, `delete()`, `generateAccessToken()`, `revokeAccessToken()` | 调 ChildRepo, 加密层 |
| `TaskService` | `create()`, `update()`, `delete()`, `listVisibleTasks()` | 调 TaskRepo, DimRepo |
| `CheckInService` | `checkIn()`, `cancel()`, `revokeByParent()` | 调 CheckInRepo, PointsService |
| `PointsService` | `recordTransaction()`, `getBalance()`, `getHistory()`, `getSummary()` | 调 PointsRepo |
| `RewardService` | `create()`, `update()`, `delete()`, `list()` | 调 RewardRepo |
| `RedemptionService` | `request()`, `approve()`, `reject()`, `fulfill()`, `list()` | 调 RedemptionRepo, PointsService, RewardRepo |
| `ReviewService` | `get()`, `submitChild()`, `submitParent()`, `list()` | 调 ReviewRepo, CheckInRepo, PointsRepo |
| `DiaryService` | `create()`, `update()`, `delete()`, `list()` | 调 DiaryRepo, 加密层 |
| `NotificationService` | `send()`, `list()`, `markRead()` | 调 NotificationRepo |

### 1.3 领域纯函数（无副作用，可独立测试）

```typescript
// packages/shared/domain/points.ts
export function calculatePoints(
  checkins: CheckIn[],
  tasks: Task[],
  redemptions: RewardRedemption[] = []
): number {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const earned = checkins
    .filter(c => !c.revoked_by_parent)
    .reduce((sum, c) => sum + (taskMap.get(c.task_id)?.point_value ?? 0), 0);
  const spent = redemptions
    .filter(r => r.status === 'fulfilled' || r.status === 'approved')
    .reduce((sum, r) => sum + r.point_cost, 0);
  return earned - spent;
}

// packages/shared/domain/dimensions.ts
export function getDimensionStatus(
  dimensionId: number,
  checkins: CheckIn[],
  tasks: Task[],
  date: Date
): 'none' | 'partial' | 'complete' {
  const dimTasks = tasks.filter(t => t.dimension_id === dimensionId && isTaskVisibleOn(t, date));
  if (dimTasks.length === 0) return 'none';
  
  const completedTaskIds = new Set(
    checkins
      .filter(c => !c.revoked_by_parent && isSameDay(c.date, date))
      .map(c => c.task_id)
  );
  
  const completedCount = dimTasks.filter(t => completedTaskIds.has(t.id)).length;
  if (completedCount === 0) return 'none';
  if (completedCount === dimTasks.length) return 'complete';
  return 'partial';
}

// packages/shared/domain/tasks.ts
export function getVisibleTasks(
  tasks: Task[],
  frequencyFilter: 'all' | Frequency,
  date: Date,
  existingCheckins: CheckIn[] = []
): Task[] {
  return tasks
    .filter(t => t.is_active)
    .filter(t => frequencyFilter === 'all' || t.frequency === frequencyFilter)
    .filter(t => isTaskVisibleOn(t, date))
    .filter(t => !isOnceTaskCompleted(t, existingCheckins));
}

function isTaskVisibleOn(task: Task, date: Date): boolean {
  switch (task.frequency) {
    case 'daily': return true;
    case 'weekly': return getDayOfWeek(date) === 1;  // Monday
    case 'once': return true;  // visible until completed
  }
}

function isOnceTaskCompleted(task: Task, checkins: CheckIn[]): boolean {
  if (task.frequency !== 'once') return false;
  return checkins.some(c => c.task_id === task.id && !c.revoked_by_parent);
}

// packages/shared/domain/checkin.ts
export function canCheckIn(
  existingCheckins: CheckIn[],
  task: Task,
  date: Date
): { ok: boolean; reason?: string } {
  if (!task.is_active) return { ok: false, reason: 'TASK_NOT_ACTIVE' };
  
  // Cannot check in for past dates
  if (isPastDate(date)) return { ok: false, reason: 'CHECKIN_PAST_DATE' };
  
  // Cannot check in for future dates (except future weekly once visible)
  if (isFutureDate(date)) return { ok: false, reason: 'CHECKIN_FUTURE_DATE' };
  
  // Once tasks can only be checked in once
  if (task.frequency === 'once') {
    const completedOnce = existingCheckins.some(
      c => c.task_id === task.id && !c.revoked_by_parent
    );
    if (completedOnce) return { ok: false, reason: 'TASK_COMPLETED_ONCE' };
  }
  
  // Cannot check in same task twice on same day (unless previous was revoked)
  const todayCheckin = existingCheckins.find(
    c => c.task_id === task.id && isSameDay(c.date, date) && !c.revoked_by_parent
  );
  if (todayCheckin) return { ok: false, reason: 'DUPLICATE_CHECKIN' };
  
  return { ok: true };
}

// packages/shared/domain/rewards.ts
export function canRedeem(
  balance: number,
  reward: Reward
): { ok: boolean; shortfall?: number } {
  if (balance >= reward.point_cost) return { ok: true };
  return { ok: false, shortfall: reward.point_cost - balance };
}

// packages/shared/domain/redemption-state.ts (see ADR-0004)
export const REDEMPTION_TRANSITIONS: Record<RedemptionStatus, Set<RedemptionStatus>> = {
  pending:  new Set(['approved', 'rejected']),
  approved: new Set(['fulfilled']),
  rejected: new Set(),
  fulfilled: new Set(),
};

export function canTransition(from: RedemptionStatus, to: RedemptionStatus): boolean {
  return REDEMPTION_TRANSITIONS[from]?.has(to) ?? false;
}
```

---

## 2. 状态机

### 2.1 RewardRedemption 状态机

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    │      POST /redemptions              │
                    │      (积分足够, reward 未停用)        │
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │    pending      │
                          │   (待审核)     │
                          │  积分未扣       │
                          └────────┬────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
                  │ PATCH /approve                  │ PATCH /reject
                  │ (家长)                          │ (家长)
                  │                                 │
                  ▼                                 ▼
          ┌─────────────────┐              ┌─────────────────┐
          │    approved     │              │    rejected     │
          │  (已通过/待履约)│              │   (已拒绝)      │
          │  积分已扣       │              │   积分未扣      │
          └────────┬────────┘              └─────────────────┘
                   │                              │
                   │ PATCH /fulfill               │ 终态
                   │ (家长)                       │ 不可转换
                   │                              ▼
                   ▼                         (无后续操作)
          ┌─────────────────┐
          │   fulfilled     │
          │   (已兑现)      │
          │   终态          │
          └─────────────────┘
```

**状态转换表**:

| 从 \ 到 | pending | approved | rejected | fulfilled |
|---------|---------|----------|----------|-----------|
| pending | - | ✅ | ✅ | ❌ |
| approved | ❌ | - | ❌ | ✅ |
| rejected | ❌ | ❌ | - | ❌ |
| fulfilled | ❌ | ❌ | ❌ | - |

**每状态的副作用**:

| 状态 | 积分变动 | 字段更新 |
|------|---------|---------|
| pending → approved | 扣除 point_cost | reviewed_at = now |
| pending → rejected | 无 | reviewed_at = now |
| approved → fulfilled | 无 | fulfilled_at = now |

**禁止转换的错误处理**:
- 任何非法转换 → 400 `INVALID_TRANSITION`，错误细节包含 `from` 和 `to`

### 2.2 Child AccessToken 状态机

```
   ┌──────────────────┐
   │  未生成           │
   │  (无 token)      │
   └─────────┬────────┘
             │ POST /children/:id/access-token
             │ (生成)
             ▼
   ┌──────────────────┐
   │  Active           │ ◄──────┐
   │  (token 有效)    │        │
   │  token_ver = N   │        │
   └──────┬───────┬───┘        │
          │       │            │
          │       │            │ POST /children/:id/access-token
          │       │            │ (重新生成 → token_ver = N+1)
          │       │            │
          │       │ DELETE    │ 旧 token 立即失效
          │       │ /access-  │
          │       │ token     │
          │       │ (撤销)    │
          │       ▼            │
          │   ┌──────────────┐│
          │   │ Revoked       ││
          │   │ (已撤销)     ││
          │   └──────┬───────┘│
          │          │        │
          │          │ 7 天    │
          │          │ 过期    │
          │          ▼        │
          │   ┌──────────────┐│
          │   │ Expired       ││
          │   └──────────────┘│
          │                   │
          ▼                   │
   ┌──────────────────┐       │
   │  Token Expired    │───────┘
   │  (过期)           │
   └──────────────────┘
```

### 2.3 WeeklyReview 提交状态机

```
┌─────────────┐
│  Initial     │
│  (无记录)   │
└──────┬──────┘
       │
       │ 孩子打开复盘页 (首次)
       │
       ▼
┌─────────────────────────────┐
│  Child Drafting              │
│  child_committed_at = NULL   │
│  parent_committed_at = NULL  │
│  locked_at = NULL            │
└──────┬───────────────────────┘
       │
       │ POST /reviews/child
       │ (孩子提交)
       │
       ▼
┌─────────────────────────────┐
│  Child Committed             │
│  child_committed_at != NULL  │
│  parent_committed_at = NULL  │
│  locked_at = NULL            │
└──────┬───────────────────────┘
       │
       │ POST /reviews/parent
       │ (家长提交，触发 lock)
       │
       ▼
┌─────────────────────────────┐
│  Locked                      │
│  child_committed_at != NULL  │
│  parent_committed_at != NULL │
│  locked_at != NULL           │
│  + aggregate 字段已计算      │
└──────────────────────────────┘
```

**对称路径**: parent 先提交 → parent_committed_at → child 后提交 → locked

**不允许的状态**:
- child_committed_at = NULL 但 locked_at != NULL
- parent_committed_at = NULL 但 locked_at != NULL
- 任一 committed_at 为 NULL 但 locked_at != NULL

CHECK 约束强制这三种"非法状态"不能持久化（参见 ADR-0005）。

---

## 3. 核心时序图

### 3.1 打卡时序图

```
Child     Frontend    Vercel    Backend     Postgres
  │          │          │          │           │
  │ tap      │          │          │           │
  │─────────>│          │          │           │
  │          │          │          │           │
  │          │ optimistic update  │           │
  │          │ (UI shows ✓)       │           │
  │          │          │          │           │
  │          │ POST /api/checkins │           │
  │          │─────────>│          │           │
  │          │          │─────────>│           │
  │          │          │          │           │
  │          │          │          │ BEGIN TX  │
  │          │          │          │ (SERIAL)  │
  │          │          │          │──────────>│
  │          │          │          │           │
  │          │          │          │           │ SELECT task
  │          │          │          │<──────────│
  │          │          │          │           │
  │          │          │          │           │ SELECT existing checkin
  │          │          │          │<──────────│
  │          │          │          │           │
  │          │          │          │           │ (if exists) ROLLBACK
  │          │          │          │<──────────│
  │          │          │          │           │
  │          │          │          │           │ INSERT checkin
  │          │          │          │──────────>│
  │          │          │          │           │
  │          │          │          │           │ SELECT MAX(balance_after)
  │          │          │          │<──────────│
  │          │          │          │           │
  │          │          │          │           │ INSERT point_transaction
  │          │          │          │──────────>│
  │          │          │          │           │
  │          │          │          │           │ COMMIT
  │          │          │          │<──────────│
  │          │          │          │           │
  │          │          │          │ 201 {     │
  │          │          │          │   points, │
  │          │          │          │   balance │
  │          │          │          │ }         │
  │          │<─────────│          │           │
  │          │          │          │           │
  │          │ invalidateQueries   │           │
  │          │ refetch balance     │           │
  │          │          │          │           │
  │          │ UI updates balance  │           │
  │<─────────│          │          │           │
│            │          │          │           │
```

### 3.2 兑换审核时序图

```
Parent    Frontend    Backend     Postgres
  │          │          │           │
  │ tap      │          │           │
  │ "通过"   │          │           │
  │─────────>│          │           │
  │          │          │           │
  │          │ PATCH    │           │
  │          │ /redemptions/        │
  │          │   :id/approve        │
  │          │─────────>│           │
  │          │          │           │
  │          │          │ BEGIN TX  │
  │          │          │ (SERIAL)  │
  │          │          │──────────>│
  │          │          │           │
  │          │          │           │ SELECT redemption FOR UPDATE
  │          │          │<──────────│
  │          │          │           │
  │          │          │ assertCanTransition
  │          │          │ ('pending','approved')
  │          │          │           │
  │          │          │           │ UPDATE redemption
  │          │          │           │   SET status='approved'
  │          │          │──────────>│
  │          │          │           │
  │          │          │           │ SELECT MAX(balance_after)
  │          │          │<──────────│
  │          │          │           │
  │          │          │ if balance - cost < 0:
  │          │          │   ROLLBACK
  │          │          │   throw INSUFFICIENT_BALANCE
  │          │          │           │
  │          │          │           │ INSERT point_transaction
  │          │          │           │   (amount = -cost)
  │          │          │──────────>│
  │          │          │           │
  │          │          │           │ COMMIT
  │          │          │<──────────│
  │          │          │           │
  │          │          │ 200 {     │
  │          │          │   status, │
  │          │          │   balance │
  │          │          │ }          │
  │          │<─────────│           │
  │          │          │           │
  │          │ invalidateQueries     │
  │          │ (redemptions,        │
  │          │  balance)            │
  │          │          │           │
  │<─────────│          │           │
```

### 3.3 每周复盘双盲提交时序图

```
Child    Parent    Frontend(Child)  Frontend(Parent)  Backend    Postgres
  │        │           │                  │               │           │
  │        │           │ GET /reviews     │               │           │
  │        │           │ ?week=2026-07-13 │               │           │
  │        │           │──────────────────────────────────>│           │
  │        │           │                  │               │           │
  │        │           │                  │               │ SELECT wr │
  │        │           │                  │               │<──────────│
  │        │           │                  │               │           │
  │        │           │                  │               │ access    │
  │        │           │                  │               │ control:  │
  │        │           │                  │               │ show own  │
  │        │           │                  │               │ hide other│
  │        │           │                  │               │           │
  │        │           │ 200 {            │               │           │
  │        │           │   best_thing,    │               │           │
  │        │           │   difficulty,    │               │           │
  │        │           │   child_request,│               │           │
  │        │           │   other: {       │               │           │
  │        │           │     status:      │               │           │
  │        │           │     "other_not   │               │           │
  │        │           │      _started"   │               │           │
  │        │           │   }              │               │           │
  │        │           │ }                │               │           │
  │        │           │<─────────────────────────────────│           │
  │        │           │                  │               │           │
  │ fills form        │                  │               │           │
  │───────────────────>│                 │               │           │
  │        │           │                  │               │           │
  │        │           │ POST /reviews/child               │           │
  │        │           │──────────────────────────────────>│           │
  │        │           │                  │               │           │
  │        │           │                  │               │ BEGIN TX  │
  │        │           │                  │               │──────────>│
  │        │           │                  │               │           │
  │        │           │                  │               │           │ SELECT wr FOR UPDATE
  │        │           │                  │               │<──────────│
  │        │           │                  │               │           │
  │        │           │                  │               │ check locked_at IS NULL
  │        │           │                  │               │           │
  │        │           │                  │               │           │ UPDATE wr SET
  │        │           │                  │               │           │   best_thing=?,
  │        │           │                  │               │           │   child_committed_at=NOW()
  │        │           │                  │               │──────────>│
  │        │           │                  │               │           │
  │        │           │                  │               │ IF parent_committed_at IS NOT NULL:
  │        │           │                  │               │   UPDATE wr SET locked_at=NOW()
  │        │           │                  │               │   COMPUTE aggregates
  │        │           │                  │               │──────────>│
  │        │           │                  │               │           │
  │        │           │                  │               │           │ COMMIT
  │        │           │                  │               │<──────────│
  │        │           │                  │               │           │
  │        │           │ 200 { locked: false }            │           │
  │        │           │<─────────────────────────────────│           │
  │        │           │                  │               │           │
  │        │           │                  │               │           │
  │        │ fills parent form           │               │           │
  │        │──────────────────────────────>│              │           │
  │        │           │                  │               │           │
  │        │           │                  │ POST /reviews/parent       │
  │        │           │                  │──────────────>│           │
  │        │           │                  │               │           │
  │        │           │                  │               │ BEGIN TX  │
  │        │           │                  │               │──────────>│
  │        │           │                  │               │           │
  │        │           │                  │               │           │ SELECT wr FOR UPDATE
  │        │           │                  │               │<──────────│
  │        │           │                  │               │           │
  │        │           │                  │               │ UPDATE wr SET
  │        │           │                  │               │   parent_observation=?,
  │        │           │                  │               │   parent_committed_at=NOW(),
  │        │           │                  │               │   locked_at=NOW()
  │        │           │                  │               │──────────>│
  │        │           │                  │               │           │
  │        │           │                  │               │           │ COMMIT
  │        │           │                  │               │<──────────│
  │        │           │                  │               │           │
  │        │           │                  │ 200 { locked: true }      │
  │        │           │                  │<──────────────│           │
  │        │           │                  │               │           │
  │        │           │                  │               │           │
  │        │           │ GET /reviews     │               │           │
  │        │           │ (refetch)        │               │           │
  │        │           │──────────────────────────────────>│           │
  │        │           │                  │               │           │
  │        │           │                  │               │ now shows:│
  │        │           │ 200 {            │               │   parent │
  │        │           │   best_thing,    │               │   observ│
  │        │           │   ...,           │               │   ation  │
  │        │           │   other: {       │               │           │
  │        │           │     parent_observation: "..."    │           │
  │        │           │   },             │               │           │
  │        │           │   locked: true   │               │           │
  │        │           │ }                │               │           │
  │        │           │<─────────────────────────────────│           │
```

### 3.4 Token 验证时序图

```
Client    Vercel    Backend    Postgres
  │          │          │           │
  │ request with       │           │
  │ Authorization:     │           │
  │ Bearer <jwt>       │           │
  │─────────>│         │           │
  │          │         │           │
  │          │ proxy   │           │
  │          │────────>│           │
  │          │         │           │
  │          │         │ auth.preHandler
  │          │         │           │
  │          │         │ extract token
  │          │         │           │
  │          │         │ try verify with PARENT_JWT_SECRET
  │          │         │   if success: request.auth = { role: 'parent', ... }
  │          │         │   else: try verify with CHILD_JWT_SECRET
  │          │         │     if success: request.auth = { role: 'child', ... }
  │          │         │       then: SELECT token_version FROM children
  │          │         │                          WHERE id = sub
  │          │         │       ─────────────────────────>│
  │          │         │       <─────────────────────────
  │          │         │       if db.token_version !== jwt.token_version
  │          │         │         → 401 TOKEN_REVOKED
  │          │         │     else: 401 UNAUTHORIZED
  │          │         │           │
  │          │         │ tenant.preHandler
  │          │         │   request.familyId = request.auth.family_id
  │          │         │   if role === 'child':
  │          │         │     request.childId = request.auth.sub
  │          │         │           │
  │          │         │ route handler
  │          │         │   (uses request.familyId / childId)
  │          │         │           │
  │          │         │   query: WHERE family_id = request.familyId
  │          │         │   ─────────────────────────>│
  │          │         │   <─────────────────────────
  │          │         │           │
  │          │         │ response  │
  │          │<────────│           │
  │<─────────│         │           │
```

---

## 4. 关键算法

### 4.1 积分余额推导

```typescript
// 不维护 balance 列；从 point_transactions 表推导

async function getBalance(childId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT balance_after
    FROM point_transactions
    WHERE child_id = ${childId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  return result.rows[0]?.balance_after ?? 0;
}
```

**为什么这样设计？**
- 单一可信源：余额始终等于最新交易的 `balance_after`
- 防止 dual-source-of-truth 漂移
- 审计简单：`SELECT * FROM point_transactions WHERE child_id = ?` 即可
- 性能：索引 `(child_id, created_at DESC)` 使查询 < 1ms

### 4.2 维度点亮状态算法

```typescript
function getDimensionStatus(
  dimensionId: number,
  checkins: CheckIn[],
  tasks: Task[],
  date: Date
): 'none' | 'partial' | 'complete' {
  // 1. 过滤出该维度当日可见的任务
  const visibleTasks = tasks.filter(t => 
    t.dimension_id === dimensionId &&
    t.is_active &&
    isTaskVisibleOn(t, date)
  );
  
  // 2. 无任务 → none
  if (visibleTasks.length === 0) return 'none';
  
  // 3. 计算当日已完成的任务（排除已撤销）
  const completedTaskIds = new Set(
    checkins
      .filter(c => 
        !c.revoked_by_parent &&
        isSameDay(c.date, date)
      )
      .map(c => c.task_id)
  );
  
  const completedCount = visibleTasks.filter(t => 
    completedTaskIds.has(t.id)
  ).length;
  
  // 4. 状态判定
  if (completedCount === 0) return 'none';
  if (completedCount === visibleTasks.length) return 'complete';
  return 'partial';
}
```

### 4.3 任务可见性算法

```typescript
function isTaskVisibleOn(task: Task, date: Date): boolean {
  // 停用任务不可见
  if (!task.is_active) return false;
  
  switch (task.frequency) {
    case 'daily':
      // 每日可见
      return true;
    
    case 'weekly':
      // 仅周一可见（PRD §3.2: 每周任务每周一 00:00 重置）
      return getDayOfWeek(date) === 1;
    
    case 'once':
      // 一次性任务：可见，除非已完成
      // (完成状态的检查在调用方做，这里只看"理论可见")
      return true;
  }
}

function getDayOfWeek(date: Date): number {
  // 0=Sunday, 1=Monday, ..., 6=Saturday
  return new Date(date).getUTCDay();
}

function isSameDay(d1: Date | string, d2: Date | string): boolean {
  const a = new Date(d1);
  const b = new Date(d2);
  return a.getUTCFullYear() === b.getUTCFullYear() &&
         a.getUTCMonth() === b.getUTCMonth() &&
         a.getUTCDate() === b.getUTCDate();
}

function isPastDate(date: Date | string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setUTCHours(0, 0, 0, 0);
  return target.getTime() < today.getTime();
}

function isFutureDate(date: Date | string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setUTCHours(0, 0, 0, 0);
  return target.getTime() > today.getTime();
}
```

### 4.4 SERIALIZABLE 重试算法

```typescript
const SERIALIZATION_ERROR_CODE = '40001';  // Postgres SSI conflict
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 50;

async function withSerializableRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      // 检查是否为序列化冲突
      if (!isSerializationError(err)) {
        throw err;  // 非重试错误，直接抛出
      }
      
      if (attempt === MAX_RETRIES) {
        // 重试次数耗尽
        logger.warn({ attempts: attempt + 1, err }, 'Serialization retries exhausted');
        throw new PointsError('SERIALIZATION_FAILED', 
          '操作冲突，请重试');
      }
      
      // 指数退避
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
      logger.debug({ attempt, backoffMs }, 'Serialization conflict, retrying');
      await sleep(backoffMs);
    }
  }
  
  throw lastError;
}

function isSerializationError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    return code === SERIALIZATION_ERROR_CODE ||
           code === '40P01';  // deadlock_detected
  }
  return false;
}
```

### 4.5 字段加密算法（详见 ADR-0009）

```
加密流程:
  plaintext → deriveRowKey(table, rowId) → AES-256-GCM(plaintext, key, iv)
            → base64(iv || ciphertext || auth_tag) → stored in DB

解密流程:
  encrypted → base64 decode → split(iv, ciphertext, auth_tag)
            → deriveRowKey(table, rowId) → AES-256-GCM-Decrypt(ciphertext, key, iv, tag)
            → plaintext

密钥派生:
  MASTER_KEY (env var, 32 bytes)
    │
    │ HKDF-SHA256(salt=tableName, info=rowId)
    │
    ▼
  perRowKey (32 bytes)

为什么这样设计？
- 每行有独立密钥 → 单行泄露不波及其他行
- 主密钥轮换时：重新派生所有 perRowKey
- HKDF 提供密钥分离性，符合 RFC 5869
```

---

## 5. 数据完整性约束

### 5.1 数据库层 CHECK 约束清单

```sql
-- 1. PointTransaction: amount 必须非零
ALTER TABLE point_transactions
  ADD CONSTRAINT pt_amount_nonzero CHECK (amount <> 0);

-- 2. PointTransaction: source_type 枚举
ALTER TABLE point_transactions
  ADD CONSTRAINT pt_source_type_valid
  CHECK (source_type IN ('task', 'reward', 'revocation'));

-- 3. PointTransaction: balance_after 不能为负
ALTER TABLE point_transactions
  ADD CONSTRAINT pt_balance_nonnegative
  CHECK (balance_after >= 0);

-- 4. CheckIn: 同一 child+task+date 唯一（除非 revoked）
-- 通过 UNIQUE INDEX 实现：
CREATE UNIQUE INDEX uq_checkin_active
  ON checkins(child_id, task_id, date)
  WHERE revoked_by_parent = false;

-- 5. RewardRedemption: status 枚举
ALTER TABLE reward_redemptions
  ADD CONSTRAINT rr_status_valid
  CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled'));

-- 6. RewardRedemption: 状态转换一致性
-- (通过 trigger 实现，见 ADR-0004)

-- 7. WeeklyReview: 提交状态一致性
ALTER TABLE weekly_reviews
  ADD CONSTRAINT wr_commit_state_valid
  CHECK (
    (child_committed_at IS NULL AND parent_committed_at IS NULL AND locked_at IS NULL) OR
    (child_committed_at IS NOT NULL AND parent_committed_at IS NULL AND locked_at IS NULL) OR
    (child_committed_at IS NULL AND parent_committed_at IS NOT NULL AND locked_at IS NULL) OR
    (child_committed_at IS NOT NULL AND parent_committed_at IS NOT NULL AND locked_at IS NOT NULL)
  );

-- 8. Task: point_value 范围
ALTER TABLE tasks
  ADD CONSTRAINT task_point_value_range
  CHECK (point_value >= 1 AND point_value <= 20);

-- 9. Task: frequency 枚举
ALTER TABLE tasks
  ADD CONSTRAINT task_frequency_valid
  CHECK (frequency IN ('daily', 'weekly', 'once'));

-- 10. Reward: tier 枚举
ALTER TABLE rewards
  ADD CONSTRAINT reward_tier_valid
  CHECK (tier IN ('small', 'medium', 'large'));

-- 11. Child: age_group 枚举
ALTER TABLE children
  ADD CONSTRAINT child_age_group_valid
  CHECK (age_group IN ('6-8', '9-11', '12-14'));
```

### 5.2 UNIQUE 约束清单

```sql
-- 1. 邮箱唯一
CREATE UNIQUE INDEX uq_parent_email ON parents(email) WHERE email IS NOT NULL;

-- 2. 手机号唯一
CREATE UNIQUE INDEX uq_parent_phone ON parents(phone) WHERE phone IS NOT NULL;

-- 3. 孩子 access_token 唯一
CREATE UNIQUE INDEX uq_child_access_token ON children(access_token)
  WHERE access_token IS NOT NULL;

-- 4. 同一家庭同一周只能有一条 WeeklyReview
CREATE UNIQUE INDEX uq_weekly_review_per_week
  ON weekly_reviews(child_id, week_start_date);

-- 5. 同一孩子+任务+档位奖励名唯一（防止家长误重复）
CREATE UNIQUE INDEX uq_reward_family_tier_title
  ON rewards(family_id, tier, title);

-- 6. PointTransaction 防止同来源重复入账
CREATE UNIQUE INDEX uq_point_transaction_source
  ON point_transactions(child_id, source_type, source_id)
  WHERE source_type IN ('task', 'reward', 'revocation');

-- 7. Parents: token_version 与 id 组合校验由应用层完成
CREATE INDEX idx_parents_token_version ON parents(id, token_version);
```

### 5.3 触发器（DB Triggers）

```sql
-- 1. 兑换状态转换合法性（详见 ADR-0004）
CREATE OR REPLACE FUNCTION enforce_redemption_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')) OR
      (OLD.status = 'approved' AND NEW.status = 'fulfilled') OR
      (OLD.status = OLD.status AND NEW.status = OLD.status)  -- no-op
    ) THEN
      RAISE EXCEPTION 'Invalid redemption transition: % -> %',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_redemption_transition
  BEFORE UPDATE OF status ON reward_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_redemption_transition();

-- 2. WeeklyReview 双方提交后自动 lock（详见 ADR-0005）
CREATE OR REPLACE FUNCTION auto_lock_weekly_review()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_committed_at IS NOT NULL
     AND NEW.parent_committed_at IS NOT NULL
     AND NEW.locked_at IS NULL THEN
    NEW.locked_at := NOW();
    -- 聚合统计由应用层在提交后异步计算
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_review_autolock
  BEFORE UPDATE ON weekly_reviews
  FOR EACH ROW
  EXECUTE FUNCTION auto_lock_weekly_review();

-- 3. 时间戳自动更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_reviews_updated_at
  BEFORE UPDATE ON weekly_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 5.4 索引策略

```sql
-- 高频查询索引
CREATE INDEX idx_checkins_child_date ON checkins(child_id, date DESC)
  WHERE revoked_by_parent = false;
CREATE INDEX idx_point_tx_child_created ON point_transactions(child_id, created_at DESC);
CREATE INDEX idx_redemptions_child_status ON reward_redemptions(child_id, status, created_at DESC);
CREATE INDEX idx_tasks_family_active ON tasks(family_id, is_active, dimension_id);
CREATE INDEX idx_rewards_family_active ON rewards(family_id, is_active, tier);
CREATE INDEX idx_diaries_child_created ON growth_diaries(child_id, created_at DESC);
```

---

## 6. 安全设计

### 6.1 认证与授权矩阵（详见 ADR-0002）

| 角色 | Token 类型 | Secret | 存储位置 | 失效方式 |
|------|-----------|--------|---------|---------|
| 家长 | JWT (HS256) | `PARENT_JWT_SECRET` | localStorage | 7 天过期 / 服务端改 secret |
| 孩子 | JWT (HS256) | `CHILD_JWT_SECRET` | httpOnly cookie | 7 天过期 / `token_version` 自增 |

**Token 版本机制**：`children.token_version` 默认为 0，每次重新生成 access_token 时 +1；旧 JWT 中 `token_version` 与 DB 不匹配 → 立即失效。

### 6.2 路由级权限（Fastify preHandler）

```typescript
// 路由装饰器：声明所需角色
fastify.route({
  method: 'POST',
  url: '/api/checkins',
  preHandler: [authPreHandler, tenantPreHandler, requireChildOrParent],
  handler: checkInHandler,
});

// requireChildOrParent: 接受家长代打卡和孩子自打卡
// requireParent: 仅家长
// requireChild: 仅孩子
```

### 6.3 多租户隔离（详见 ADR-0006）

```typescript
// 所有 repository 方法必须接受 familyId 并加入 WHERE
function tenantScope(familyId: string) {
  return { family_id: familyId } as const;
}

// 错误：跨家庭访问不返回 403，返回 404（防探测）
if (child.family_id !== request.familyId) {
  throw new NotFoundError('CHILD_NOT_FOUND');
}
```

### 6.4 输入校验（Zod）

```typescript
const CreateTaskSchema = z.object({
  title: z.string().min(1).max(30),
  dimension_id: z.number().int().min(1).max(5),
  point_value: z.number().int().min(1).max(20),
  frequency: z.enum(['daily', 'weekly', 'once']),
  description: z.string().max(200).optional(),
});

// Fastify 集成：所有 body / query / params 走 Zod parse
fastify.post('/api/tasks', {
  preHandler: [authPreHandler, tenantPreHandler, requireParent],
  schema: { body: zodToJsonSchema(CreateTaskSchema) },
  handler: createTaskHandler,
});
```

### 6.5 速率限制

| 路由 | 限制 | 理由 |
|------|------|------|
| POST /api/auth/login | 10/min/IP | 防爆破 |
| POST /api/auth/register | 5/hour/IP | 防批量注册 |
| POST /api/checkins | 60/min/user | 正常使用上限 |
| 其他 API | 300/min/user | 兜底 |

实现：`@fastify/rate-limit`，Redis 存储计数器（Phase 2 引入；MVP 用内存）。

### 6.6 安全响应头

```typescript
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind 需要
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: 'strict-origin-when-cross-origin',
});
```

### 6.7 敏感数据脱敏（日志）

| 字段 | 日志输出 |
|------|---------|
| parent.password_hash | `[REDACTED]` |
| parent.email | `p***@e***.com` |
| child.access_token | `[REDACTED]` |
| child.name | 保留（非敏感） |
| 请求体含 password 字段 | 字段被覆盖为 `***` |

通过 pino 的 redact 选项配置：

```typescript
const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.access_token',
      'password_hash',
      'access_token',
    ],
    censor: '[REDACTED]',
  },
});
```

### 6.8 字段级加密（详见 ADR-0009）

- **加密字段**：`weekly_reviews.best_thing`, `weekly_reviews.difficulty`, `weekly_reviews.parent_observation`, `weekly_reviews.child_request`, `growth_diaries.content`, `growth_diaries.title`
- **不加密**：积分、任务元数据、奖励元数据（用于聚合查询）
- **密钥层级**：Master Key → HKDF → perTableKey → HKDF → perRowKey

---

## 7. 并发控制

### 7.1 隔离级别选择

| 场景 | 隔离级别 | 理由 |
|------|---------|------|
| 积分相关写操作 | SERIALIZABLE | 防止幻读导致余额不一致 |
| 兑换审批 + 扣分 | SERIALIZABLE | redemption + point_transaction 原子 |
| WeeklyReview 提交 | SERIALIZABLE | 双方同时提交时 lock_at 不漏 |
| 一般读 | READ COMMITTED | 默认即可 |
| 报表聚合 | READ COMMITTED | 允许稍后一致 |

### 7.2 SERIALIZABLE 重试策略（详见 §4.4）

- **错误码**：`40001` (serialization_failure) / `40P01` (deadlock_detected)
- **最大重试**：3 次
- **退避**：50ms × 2^attempt（线性指数退避）
- **超限**：抛 `SERIALIZATION_FAILED` (503)

### 7.3 乐观并发控制（离线打卡冲突，详见 PRD §9.8）

```typescript
// 客户端缓存打卡时的 client_revision
// 提交时带上 if_match: revision
POST /api/checkins { ..., client_revision: 7 }

// 服务端
const current = await getCheckinRevision(child_id, date);
if (current !== body.client_revision) {
  // 冲突：服务端有更新（家长撤销了某项打卡）
  throw new ConflictError('CHECKIN_REVISION_MISMATCH', {
    server_revision: current,
    server_state: await getTodayCheckins(child_id),
  });
}
// 正常处理 + revision += 1
```

### 7.4 幂等性保证

| 操作 | 幂等键 | 实现 |
|------|--------|------|
| 打卡 | UNIQUE(child_id, task_id, date) WHERE revoked=false | INSERT ... ON CONFLICT DO NOTHING |
| 积分入账 | UNIQUE(child_id, source_type, source_id) | DB 约束兜底 |
| 兑换创建 | 客户端传 idempotency_key（UUID） | 缓存 24h 响应 |
| 兑换审批 | 状态机 trigger 强制转换 | 重复 approve → 无 op 或 409 |

### 7.5 锁粒度

- **行锁**：`SELECT ... FOR UPDATE` 用于 redemption 审批、weekly_review 提交
- **表锁**：禁止使用（会导致全表阻塞）
- **应用锁**：Phase 2 引入 Redis 分布式锁（如导出任务）

### 7.6 死锁防护

所有多行事务按统一顺序加锁：
- 跨孩子操作：按 `child_id ASC` 排序
- 跨表操作：`redemptions → point_transactions` 顺序

---

## 8. 性能设计

### 8.1 性能预算

| 接口 | P50 | P95 | P99 |
|------|-----|-----|-----|
| GET /api/checkins/today | 50ms | 200ms | 500ms |
| POST /api/checkins | 80ms | 300ms | 800ms |
| GET /api/points/balance | 20ms | 80ms | 200ms |
| GET /api/rewards | 30ms | 100ms | 300ms |
| POST /api/redemptions | 100ms | 400ms | 1000ms |
| PATCH /api/redemptions/:id/approve | 150ms | 600ms | 1500ms |
| GET /api/growth-map | 100ms | 400ms | 1000ms |

### 8.2 前端性能

- **Bundle 体积**：首屏 JS ≤ 200KB gzipped
- **代码分割**：按路由懒加载（`React.lazy` + `Suspense`）
- **图片**：全部走 Vercel Image Optimization（自动 WebP/AVIF）
- **缓存策略**：
  - TanStack Query staleTime: 任务/奖励 5min，积分余额 0s（实时）
  - HTTP Cache-Control: 静态资源 immutable，HTML no-cache
- **重渲染优化**：`useMemo` / `React.memo` 仅在 profiler 显示瓶颈时使用

### 8.3 后端性能

- **N+1 防护**：所有 list 接口使用 `db.select().leftJoin()` 一次性查询
- **分页**：cursor-based（避免 OFFSET 性能问题）
  ```typescript
  // GET /api/redemptions?cursor=eyJpZCI6ImFiYyJ9&limit=20
  const rows = await db.select()
    .from(redemptions)
    .where(and(
      eq(redemptions.child_id, childId),
      lt(redemptions.created_at, cursor.timestamp),
    ))
    .limit(limit + 1);
  ```
- **查询计划监控**：CI 跑 `EXPLAIN ANALYZE` 关键查询，超时告警

### 8.4 数据库性能

- **索引覆盖**：高频查询走 index-only scan（详见 §5.4）
- **连接池**：Drizzle + postgres-js，pool size = 10（Railway 默认）
- **慢查询阈值**：>500ms 告警

### 8.5 缓存策略

| 数据 | 缓存层 | TTL | 失效方式 |
|------|--------|-----|---------|
| 维度列表 | 内存（启动加载） | 永久 | 重启 |
| 任务模板 | 内存 | 1h | 手动刷新 |
| 用户积分余额 | 不缓存 | - | 实时查询 |
| 今日打卡列表 | TanStack Query | 30s | 用户操作后 invalidate |
| 奖励列表 | TanStack Query | 5min | 编辑后 invalidate |

### 8.6 资源限制（MVP Free Tier）

| 资源 | 限制 | 应对 |
|------|------|------|
| Vercel 带宽 | 100GB/月 | 图片优化 + CDN |
| Railway RAM | 512MB | 控制日志输出 + Drizzle 流式查询 |
| Neon 存储 | 10GB | 加密字段不冗余 + 日志归档 |
| GitHub Actions | 2000 min/月 | 缓存 pnpm + 并行矩阵 |

---

## 9. 可观测性设计

### 9.1 日志分层

| 层级 | 内容 | 输出 |
|------|------|------|
| ERROR | 未处理异常、DB 失败、外部服务失败 | stdout + Sentry |
| WARN | SERIALIZABLE 重试、限流命中、认证失败 | stdout |
| INFO | 业务关键事件（注册、兑换、复盘提交） | stdout |
| DEBUG | 查询参数、中间状态 | 仅本地开发 |
| TRACE | SQL 语句、HTTP 请求详情 | 仅本地开发 |

### 9.2 结构化日志格式

```json
{
  "level": "info",
  "time": 1721091234567,
  "requestId": "req_abc123",
  "userId": "usr_xyz",
  "familyId": "fam_001",
  "childId": "chl_001",
  "event": "redemption.approved",
  "redemptionId": "rdm_001",
  "amount": -30,
  "balanceAfter": 50,
  "durationMs": 142,
  "msg": "Redemption approved"
}
```

### 9.3 关键指标（Metrics）

| 指标 | 类型 | 标签 | 告警阈值 |
|------|------|------|---------|
| `http_requests_total` | counter | route, status | - |
| `http_request_duration_seconds` | histogram | route | P99 > 2s |
| `db_query_duration_seconds` | histogram | table | P99 > 500ms |
| `serialization_retries_total` | counter | - | 1min 内 > 10 |
| `auth_failures_total` | counter | reason | 1min 内 > 20 |
| `redemptions_pending_count` | gauge | - | 单家庭 > 10 |
| `weekly_review_reminder_sent` | counter | - | - |
| `job_duration_seconds` | histogram | job_name | P95 > 30s |

MVP 用 `pino` + 自定义 metrics endpoint；Phase 2 引入 Prometheus + Grafana。

### 9.4 链路追踪

- 每个请求注入 `requestId`（UUID v4）
- 通过 `X-Request-Id` header 跨服务传递
- DB 查询附带 `requestId` 到 pg `application_name`
- 前端 console.error 自动上报 requestId

### 9.5 健康检查端点

```typescript
// GET /api/health
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2026-07-16T...",
  "checks": {
    "database": { "status": "healthy", "latencyMs": 12 },
    "scheduler": { "status": "healthy", "lastRunAt": "..." },
    "encryption": { "status": "healthy", "keyLoaded": true }
  },
  "version": "1.0.0"
}
```

Railway 用 `/api/health` 做 liveness/readiness 探针。

### 9.6 告警渠道

| 严重度 | 渠道 | 触发条件 |
|--------|------|---------|
| P0 | 邮件 + 短信 | 健康检查 unhealthy 超过 1min |
| P1 | 邮件 | 5xx 错误率 > 5% / 5min |
| P2 | Slack | SERIALIZABLE 重试超限 |
| P3 | 日志归档 | 慢查询 |

MVP：仅邮件（Railway 内置）；Phase 2：Sentry + Slack。

---

## 10. 错误处理与重试

### 10.1 统一错误响应格式

```typescript
// 成功响应
{ "data": {...}, "meta": { "pagination": {...} } }

// 错误响应
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "积分余额不足",
    "details": { "balance": 5, "required": 30, "shortfall": 25 },
    "requestId": "req_abc123"
  }
}
```

### 10.2 错误码字典

| code | HTTP | 说明 | 客户端处理 |
|------|------|------|-----------|
| VALIDATION_ERROR | 400 | Zod 校验失败 | 显示字段错误 |
| INVALID_CREDENTIALS | 401 | 邮箱/密码错误 | 清空密码框 |
| TOKEN_EXPIRED | 401 | JWT 过期 | 跳登录 |
| TOKEN_REVOKED | 401 | token_version 不匹配 | 跳登录 |
| UNAUTHORIZED | 401 | 未带 token | 跳登录 |
| FORBIDDEN | 403 | 角色不足 | 显示无权限 |
| NOT_FOUND | 404 | 资源不存在 | 显示 404 页 |
| CONFLICT | 409 | 状态冲突 | 显示冲突原因 |
| CHECKIN_REVISION_MISMATCH | 409 | 离线打卡冲突 | 弹冲突解决 UI |
| RATE_LIMITED | 429 | 限流 | 显示倒计时 |
| INSUFFICIENT_BALANCE | 422 | 积分不足 | 显示差多少分 |
| SERIALIZATION_FAILED | 503 | 重试耗尽 | 提示稍后重试 |
| INTERNAL_ERROR | 500 | 未预期错误 | 显示 requestId |

### 10.3 自定义错误类

```typescript
class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

class ValidationError extends AppError {
  constructor(details: Record<string, string[]>) {
    super('VALIDATION_ERROR', 400, '请求参数校验失败', details);
  }
}

class InsufficientBalanceError extends AppError {
  constructor(balance: number, required: number) {
    super('INSUFFICIENT_BALANCE', 422, '积分余额不足', {
      balance, required, shortfall: required - balance,
    });
  }
}

// Fastify 全局错误处理
fastify.setErrorHandler((err, request, reply) => {
  const requestId = request.id;
  
  if (err instanceof AppError) {
    reply.status(err.statusCode).send({
      error: { code: err.code, message: err.message, details: err.details, requestId }
    });
    return;
  }
  
  // Zod 错误转换
  if (err instanceof ZodError) {
    reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: '请求参数校验失败', details: err.flatten(), requestId }
    });
    return;
  }
  
  // 兜底
  logger.error({ err, requestId }, 'Unhandled error');
  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', requestId }
  });
});
```

### 10.4 重试策略

| 场景 | 重试次数 | 退避 | 错误码 |
|------|---------|------|--------|
| DB 序列化冲突 | 3 | 50ms × 2^n | 40001, 40P01 |
| 外部 HTTP 调用（无） | - | - | - |
| 前端 mutation 失败 | 0 | - | 由用户决定 |
| 前端 query 失败 | 3 | 1s, 2s, 4s | TanStack Query 默认 |

### 10.5 前端错误边界

```tsx
<ErrorBoundary
  FallbackComponent={({ error, resetErrorBoundary }) => (
    <ErrorPage error={error} onRetry={resetErrorBoundary} />
  )}
  onError={(error, info) => {
    logger.error({ error, info, requestId: getRequestId() });
  }}
>
  <App />
</ErrorBoundary>
```

- 路由级 ErrorBoundary：每个路由独立捕获
- Query ErrorBoundary：TanStack Query 失败不冒泡到全局

---

## 11. 数据库 Schema 完整定义

> Drizzle ORM schema，按依赖顺序排列。所有表使用 `pgSchema` 显式 schema。

```typescript
// src/server/db/schema.ts
import { pgSchema, pgTable, uuid, varchar, integer, boolean,
         timestamp, date, text, enum as pgEnum, jsonb, customType } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

// ---- 枚举 ----
export const frequencyEnum = pgEnum('frequency', ['daily', 'weekly', 'once']);
export const ageGroupEnum = pgEnum('age_group', ['6-8', '9-11', '12-14']);
export const tierEnum = pgEnum('tier', ['small', 'medium', 'large']);
export const redemptionStatusEnum = pgEnum('redemption_status',
  ['pending', 'approved', 'rejected', 'fulfilled']);
export const sourceTypeEnum = pgEnum('source_type',
  ['task', 'reward', 'revocation']);
export const diaryCategoryEnum = pgEnum('diary_category',
  ['drawing', 'journal', 'cooking', 'experiment', 'exercise', 'other']);

// ---- 加密文本类型（详见 ADR-0009）----
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() { return 'text'; },
  toDriver(value: string) { return encryptField(value); },
  fromDriver(value: string) { return decryptField(value); },
});

// ---- Parents ----
export const parents = appSchema.table('parents', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique(),
  phone: varchar('phone', { length: 20 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Families ----
export const families = appSchema.table('families', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id),
  name: varchar('name', { length: 100 }).notNull(),
  summerStartDate: date('summer_start_date'),
  summerEndDate: date('summer_end_date'),
  achievementWallEnabled: boolean('achievement_wall_enabled').notNull().default(false),
  reviewReminderTime: varchar('review_reminder_time', { length: 5 }).notNull().default('18:00'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Children ----
export const children = appSchema.table('children', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id),
  name: varchar('name', { length: 50 }).notNull(),
  avatar: varchar('avatar', { length: 500 }),
  ageGroup: ageGroupEnum('age_group').notNull(),
  accessToken: varchar('access_token', { length: 64 }).unique(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Dimensions ----
export const dimensions = appSchema.table('dimensions', {
  id: integer('id').primaryKey(),
  name: varchar('name', { length: 30 }).notNull(),
  icon: varchar('icon', { length: 50 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull(),
});

// ---- Tasks ----
export const tasks = appSchema.table('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id),
  dimensionId: integer('dimension_id').notNull().references(() => dimensions.id),
  title: varchar('title', { length: 30 }).notNull(),
  pointValue: integer('point_value').notNull(),
  frequency: frequencyEnum('frequency').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- CheckIns ----
export const checkins = appSchema.table('checkins', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  date: date('date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedByParent: boolean('revoked_by_parent').notNull().default(false),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ---- PointTransactions ----
export const pointTransactions = appSchema.table('point_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id),
  amount: integer('amount').notNull(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Rewards ----
export const rewards = appSchema.table('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull().references(() => families.id),
  tier: tierEnum('tier').notNull(),
  pointCost: integer('point_cost').notNull(),
  title: varchar('title', { length: 50 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- RewardRedemptions ----
export const rewardRedemptions = appSchema.table('reward_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id),
  rewardId: uuid('reward_id').notNull().references(() => rewards.id),
  pointCost: integer('point_cost').notNull(),
  childNote: text('child_note'),
  status: redemptionStatusEnum('status').notNull().default('pending'),
  parentNote: text('parent_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
});

// ---- WeeklyReviews ----
export const weeklyReviews = appSchema.table('weekly_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id),
  weekStartDate: date('week_start_date').notNull(),
  bestThing: encryptedText('best_thing'),
  difficulty: encryptedText('difficulty'),
  parentObservation: encryptedText('parent_observation'),
  childRequest: encryptedText('child_request'),
  taskCount: integer('task_count'),
  pointEarned: integer('point_earned'),
  dimensionCount: integer('dimension_count'),
  childCommittedAt: timestamp('child_committed_at', { withTimezone: true }),
  parentCommittedAt: timestamp('parent_committed_at', { withTimezone: true }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- GrowthDiaries ----
export const growthDiaries = appSchema.table('growth_diaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().references(() => children.id),
  title: encryptedText('title').notNull(),
  content: encryptedText('content').notNull(),
  category: diaryCategoryEnum('category').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- AuditLogs ----
export const auditLogs = appSchema.table('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  actorRole: varchar('actor_role', { length: 20 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  resourceType: varchar('resource_type', { length: 30 }).notNull(),
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

迁移文件位置：`src/server/db/migrations/0001_init.sql`，由 `drizzle-kit generate` 自动生成。

---

## 12. 关键代码骨架

> 仅展示核心骨架，完整实现在各模块。所有路径相对项目根。

### 12.1 项目目录结构

> **⚠️ 修订 (2026-07-16, Conflict #2 resolution)**: 原单包 `src/server/...` 布局**已废弃**。权威目录结构以 **ARCHITECTURE.md §B** 的 pnpm workspace monorepo 为准。

**新结构摘要** (详见 ARCHITECTURE.md §B):
- `apps/web/` — React SPA (Vercel): pages, components, queries, stores, api, styles
- `apps/api/` — Fastify Backend (Railway): modules/{auth,family,children,tasks,...}, db, crypto, jobs, middleware, utils
- `packages/shared/` — 共享类型 + Zod schemas + 领域纯函数 + errors
- `tests/` — unit, integration, component, e2e
- `pnpm-workspace.yaml` at root

**下方旧结构 (已废弃，勿用于实现)**:

```
growth-points-bank/
├── docs/                       # 文档（已完成）
├── src/
│   ├── shared/                 # 共享代码（前后端通用）
│   │   ├── domain/             # 领域纯函数
│   │   │   ├── points.ts       # calculatePoints, getBalance
│   │   │   ├── dimensions.ts   # getDimensionStatus
│   │   │   ├── tasks.ts        # getVisibleTasks, canCheckIn
│   │   │   ├── rewards.ts      # canRedeem, canTransition
│   │   │   └── reviews.ts      # canCommit, isLocked
│   │   ├── schemas/            # Zod schemas
│   │   │   ├── auth.ts
│   │   │   ├── task.ts
│   │   │   └── ...
│   │   ├── errors.ts           # AppError 类层级
│   │   ├── constants.ts        # 错误码、枚举常量
│   │   └── types.ts            # 共享 TS 类型
│   ├── server/                 # 后端
│   │   ├── routes/             # Fastify 路由（按领域分文件）
│   │   │   ├── auth.ts
│   │   │   ├── children.ts
│   │   │   ├── tasks.ts
│   │   │   ├── checkins.ts
│   │   │   ├── points.ts
│   │   │   ├── rewards.ts
│   │   │   ├── redemptions.ts
│   │   │   ├── reviews.ts
│   │   │   ├── diaries.ts
│   │   │   └── health.ts
│   │   ├── services/          # 领域服务（应用层）
│   │   │   ├── AuthService.ts
│   │   │   ├── CheckInService.ts
│   │   │   ├── RedemptionService.ts
│   │   │   ├── ReviewService.ts
│   │   │   └── ...
│   │   ├── repositories/       # 仓储层（DB 访问）
│   │   │   ├── ParentRepository.ts
│   │   │   ├── ChildRepository.ts
│   │   │   └── ...
│   │   ├── db/
│   │   │   ├── schema.ts       # Drizzle schema
│   │   │   ├── client.ts       # DB 连接池
│   │   │   ├── migrations/     # SQL 迁移
│   │   │   └── seed.ts         # 维度 + 任务模板
│   │   ├── plugins/           # Fastify 插件
│   │   │   ├── auth.ts        # preHandler: JWT 验证
│   │   │   ├── tenant.ts      # preHandler: familyId 注入
│   │   │   ├── errorHandler.ts
│   │   │   └── rateLimit.ts
│   │   ├── jobs/              # 后台任务（详见 ADR-0010）
│   │   │   ├── scheduler.ts
│   │   │   ├── weeklyReviewReminder.ts
│   │   │   └── fulfillmentReminder.ts
│   │   ├── utils/
│   │   │   ├── crypto.ts      # AES-256-GCM（详见 ADR-0009）
│   │   │   ├── retry.ts       # withSerializableRetry
│   │   │   └── logger.ts
│   │   ├── app.ts             # Fastify 实例构造
│   │   └── index.ts           # 入口（启动 server + scheduler）
│   ├── client/                # 前端
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── pages/             # 路由页面
│   │   │   ├── GrowthMapPage.tsx
│   │   │   ├── CheckInPage.tsx
│   │   │   ├── RewardsPage.tsx
│   │   │   ├── RedemptionHistoryPage.tsx
│   │   │   ├── WeeklyReviewPage.tsx
│   │   │   ├── DiaryListPage.tsx
│   │   │   ├── DiaryEditorPage.tsx
│   │   │   ├── ParentDashboardPage.tsx
│   │   │   ├── TaskManagePage.tsx
│   │   │   ├── RewardManagePage.tsx
│   │   │   ├── ChildManagePage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/        # 通用组件
│   │   │   ├── GrowthMap.tsx
│   │   │   ├── TaskCard.tsx
│   │   │   ├── PointsBalance.tsx
│   │   │   ├── RewardCard.tsx
│   │   │   ├── RedemptionModal.tsx
│   │   │   └── ...
│   │   ├── hooks/             # TanStack Query hooks
│   │   │   ├── useCheckins.ts
│   │   │   ├── usePoints.ts
│   │   │   ├── useRewards.ts
│   │   │   └── ...
│   │   ├── stores/            # Zustand stores
│   │   │   ├── authStore.ts
│   │   │   └── uiStore.ts
│   │   ├── api/               # API client
│   │   │   ├── client.ts       # fetch 包装
│   │   │   └── endpoints.ts
│   │   └── styles/            # Tailwind + global CSS
├── tests/                     # 测试（详见 TDD_SPEC.md）
│   ├── unit/
│   ├── integration/
│   ├── component/
│   └── e2e/
├── .github/workflows/         # CI
├── drizzle.config.ts          # Drizzle 配置
├── vitest.config.ts
├── package.json
├── tsconfig.json
└── vercel.json                # Vercel 部署配置
```

### 12.2 后端入口骨架

```typescript
// src/server/index.ts
import { buildApp } from './app';
import { startScheduler } from './jobs/scheduler';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const app = await buildApp();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, 'Server started');

  if (process.env.ENABLE_SCHEDULER === 'true') {
    startScheduler();
    logger.info('Scheduler started');
  }
}

main().catch(err => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
```

### 12.3 Fastify app 构造骨架

```typescript
// src/server/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { logger } from './utils/logger';
import { authPlugin } from './plugins/auth';
import { tenantPlugin } from './plugins/tenant';
import { errorHandlerPlugin } from './plugins/errorHandler';
import { AppError } from '../shared/errors';

import authRoutes from './routes/auth';
import childrenRoutes from './routes/children';
// ... 其他路由

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    genReqId: () => crypto.randomUUID(),
  });

  // 插件
  await app.register(helmet);
  await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(errorHandlerPlugin);

  // 路由
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(childrenRoutes, { prefix: '/api/children' });
  // ...

  // 健康检查
  app.get('/api/health', async () => {
    // TODO: 检查 DB / scheduler / encryption
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  return app;
}
```

### 12.4 前端入口骨架

```tsx
// src/client/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
// 或 React Router v6
import { ErrorBoundary } from 'react-error-boundary';
import App from './App';
import { ErrorPage } from './components/ErrorPage';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.pow(2, attempt) * 1000,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={ErrorPage}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
```

### 12.5 Repository 骨架

```typescript
// src/server/repositories/ChildRepository.ts
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { children } from '../db/schema';

export const ChildRepository = {
  async findById(id: string, familyId: string) {
    const [row] = await db.select()
      .from(children)
      .where(and(
        eq(children.id, id),
        eq(children.familyId, familyId),  // 强制租户隔离
      ))
      .limit(1);
    return row ?? null;
  },

  async findByAccessToken(token: string) {
    const [row] = await db.select()
      .from(children)
      .where(eq(children.accessToken, token))
      .limit(1);
    return row ?? null;
  },

  async create(data: { familyId: string; name: string; ageGroup: string }) {
    const [row] = await db.insert(children).values(data).returning();
    return row;
  },

  async regenerateAccessToken(id: string, familyId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [row] = await db.update(children)
      .set({
        accessToken: token,
        tokenExpiresAt: expiresAt,
        tokenVersion: sql`${children.tokenVersion} + 1`,
      })
      .where(and(eq(children.id, id), eq(children.familyId, familyId)))
      .returning();
    return row;
  },
};
```

### 12.6 Service 骨架（兑换审批）

```typescript
// src/server/services/RedemptionService.ts
import { db } from '../db/client';
import { rewardRedemptions, pointTransactions } from '../db/schema';
import { withSerializableRetry } from '../utils/retry';
import { AppError, InsufficientBalanceError } from '../../shared/errors';
import { canTransition, REDEMPTION_TRANSITIONS } from '../../shared/domain/rewards';

export const RedemptionService = {
  async approve(redemptionId: string, familyId: string, parentNote?: string) {
    return withSerializableRetry(async () => {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

        const [redemption] = await tx.select()
          .from(rewardRedemptions)
          .where(eq(rewardRedemptions.id, redemptionId))
          .for('update')
          .limit(1);

        if (!redemption) throw new AppError('NOT_FOUND', 404, '兑换记录不存在');

        // 跨租户访问 → 404（不暴露存在性）
        const child = await ChildRepository.findById(redemption.childId, familyId);
        if (!child) throw new AppError('NOT_FOUND', 404, '兑换记录不存在');

        if (!canTransition(redemption.status, 'approved')) {
          throw new AppError('CONFLICT', 409, '当前状态不可审核通过', {
            current: redemption.status,
            target: 'approved',
          });
        }

        // 检查余额
        const balance = await getBalance(tx, redemption.childId);
        if (balance < redemption.pointCost) {
          throw new InsufficientBalanceError(balance, redemption.pointCost);
        }

        // 更新兑换状态
        await tx.update(rewardRedemptions)
          .set({ status: 'approved', reviewedAt: new Date(), parentNote })
          .where(eq(rewardRedemptions.id, redemptionId));

        // 扣分（source_id = redemption.id）
        await tx.insert(pointTransactions).values({
          childId: redemption.childId,
          amount: -redemption.pointCost,
          sourceType: 'reward',
          sourceId: redemptionId,
          balanceAfter: balance - redemption.pointCost,
        });
      });
    });
  },
};
```

### 12.7 后台任务骨架

```typescript
// src/server/jobs/scheduler.ts
import cron from 'node-cron';
import { logger } from '../utils/logger';
import { runWeeklyReviewReminder } from './weeklyReviewReminder';
import { runFulfillmentReminder } from './fulfillmentReminder';

export function startScheduler() {
  // 每周日 18:00 触发每周复盘提醒
  cron.schedule('0 18 * * 0', async () => {
    await runWithLogging('weeklyReviewReminder', runWeeklyReviewReminder);
  });

  // 每天 09:00 检查超 7 天未兑现的兑换
  cron.schedule('0 9 * * *', async () => {
    await runWithLogging('fulfillmentReminder', runFulfillmentReminder);
  });

  logger.info('Scheduler registered: 2 jobs');
}

async function runWithLogging(name: string, fn: () => Promise<void>) {
  const runId = crypto.randomUUID();
  const start = Date.now();
  logger.info({ runId, job: name }, 'Job started');
  try {
    await fn();
    logger.info({ runId, job: name, durationMs: Date.now() - start }, 'Job completed');
  } catch (err) {
    logger.error({ runId, job: name, err, durationMs: Date.now() - start }, 'Job failed');
  }
}
```

---

## 附录：与 ADR 索引对照

| 章节 | 关联 ADR |
|------|---------|
| §2 状态机 | ADR-0004 (兑换状态机), ADR-0005 (双盲复盘) |
| §3.3 时序图 | ADR-0005 (双盲复盘) |
| §3.4 时序图 | ADR-0002 (双 JWT 认证) |
| §4.1-4.4 算法 | ADR-0003 (积分完整性) |
| §4.5 加密算法 | ADR-0009 (字段级加密) |
| §5 数据完整性 | ADR-0003, ADR-0004, ADR-0005 |
| §6 安全设计 | ADR-0002, ADR-0006, ADR-0009 |
| §7 并发控制 | ADR-0003, ADR-0005 |
| §11 Schema | 所有 ADR 的 DB 决策 |
| §12.7 后台任务 | ADR-0010 (后台作业) |

— 文档结束 —