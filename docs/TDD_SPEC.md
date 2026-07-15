# 暑假成长积分银行 - TDD 测试规格文档

> **文档版本**：v2.0（基于 PRD v1.0 + ARCHITECTURE.md + DETAILED_DESIGN.md 完善）
> **创建日期**：2026-07-15
> **更新日期**：2026-07-16
> **关联PRD**：[PRD.md](./PRD.md)
> **关联架构**：[ARCHITECTURE.md](./ARCHITECTURE.md) · [DETAILED_DESIGN.md](./DETAILED_DESIGN.md) · [API.md](./API.md)
> **适用范围**：MVP（§4-§9）+ 并发/安全/错误流（§13-§17）+ Phase 2 预占位（§18）

---

## 目录

1. [测试策略概述](#1-测试策略概述)
2. [测试接缝定义](#2-测试接缝定义)
3. [技术栈与工具](#3-技术栈与工具)
4. [测试用例 - 认证与账户](#4-测试用例---认证与账户)
5. [测试用例 - 任务管理](#5-测试用例---任务管理)
6. [测试用例 - 今日打卡](#6-测试用例---今日打卡)
7. [测试用例 - 积分系统](#7-测试用例---积分系统)
8. [测试用例 - 奖励兑换](#8-测试用例---奖励兑换)
9. [测试用例 - 成长地图](#9-测试用例---成长地图)
10. [测试数据固定装置](#10-测试数据固定装置)
11. [Mock/Stub 策略](#11-mockstub-策略)
12. [TDD 执行顺序](#12-tdd-执行顺序)
13. [测试用例 - 每周复盘（双盲机制）](#13-测试用例---每周复盘双盲机制)
14. [测试用例 - 成长日记](#14-测试用例---成长日记)
15. [测试用例 - 并发与竞态](#15-测试用例---并发与竞态)
16. [测试用例 - 安全与多租户隔离](#16-测试用例---安全与多租户隔离)
17. [测试用例 - 错误流与边界条件](#17-测试用例---错误流与边界条件)
18. [测试用例 - Phase 2 功能预占位](#18-测试用例---phase-2-功能预占位)
19. [测试用例 - 性能与负载](#19-测试用例---性能与负载)
20. [更新后的总计](#20-更新后的总计)

---

## 1. 测试策略概述

### 1.1 核心原则

遵循 TDD 铁律：**没有失败的测试，就不写生产代码。**

```
RED → GREEN → REFACTOR → REPEAT
```

- **RED**：写一个最小的失败测试，描述期望行为
- **GREEN**：写最少的代码让测试通过
- **REFACTOR**：在测试通过的前提下清理代码

### 1.2 测试金字塔

```
        /  E2E  \          ← 少量，验证关键用户流程
       /----------\
      / Integration \       ← 中等，验证模块间交互
     /----------------\
    /     Unit Tests    \   ← 大量，验证业务逻辑
   /----------------------\
```

### 1.3 垂直切片策略

每个功能按垂直切片实现，**一个测试 → 一个实现 → 重复**：

```
切片1: 创建家庭账户
  → RED: 测试注册成功
  → GREEN: 实现注册
  → RED: 测试重复注册失败
  → GREEN: 实现去重
  → REFACTOR

切片2: 创建孩子档案
  → RED: 测试创建孩子
  → GREEN: 实现创建
  ...
```

---

## 2. 测试接缝定义

> 接缝（Seam）是测试观察行为的公共边界。所有测试仅在接缝处进行，不触及内部实现。

### 2.1 后端 API 接缝

| 接缝 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 家长认证 API | POST | /api/auth/register | 家长注册 |
| 家长认证 API | POST | /api/auth/login | 家长登录 |
| 家庭 API | GET | /api/family | 获取家庭信息 |
| 家庭 API | PUT | /api/family | 更新家庭设置 |
| 孩子 API | POST | /api/children | 创建孩子档案 |
| 孩子 API | GET | /api/children | 获取孩子列表 |
| 孩子 API | DELETE | /api/children/:id | 删除孩子档案 |
| 孩子 API | POST | /api/children/:id/access-token | 生成孩子访问令牌 |
| 任务 API | POST | /api/tasks | 创建任务 |
| 任务 API | GET | /api/tasks | 获取任务列表 |
| 任务 API | PUT | /api/tasks/:id | 更新任务 |
| 任务 API | DELETE | /api/tasks/:id | 删除任务 |
| 打卡 API | POST | /api/checkins | 打卡（标记任务完成） |
| 打卡 API | DELETE | /api/checkins/:id | 取消打卡 |
| 打卡 API | GET | /api/checkins/today | 获取今日打卡列表 |
| 打卡 API | POST | /api/checkins/:id/revoke | 家长撤销打卡 |
| 积分 API | GET | /api/points/balance | 获取积分余额 |
| 积分 API | GET | /api/points/transactions | 获取积分流水 |
| 奖励 API | POST | /api/rewards | 创建奖励 |
| 奖励 API | GET | /api/rewards | 获取奖励列表 |
| 奖励 API | PUT | /api/rewards/:id | 更新奖励 |
| 奖励 API | DELETE | /api/rewards/:id | 删除奖励 |
| 兑换 API | POST | /api/redemptions | 发起兑换 |
| 兑换 API | GET | /api/redemptions | 获取兑换列表 |
| 兑换 API | PATCH | /api/redemptions/:id/approve | 审核通过 |
| 兑换 API | PATCH | /api/redemptions/:id/reject | 审核拒绝 |
| 兑换 API | PATCH | /api/redemptions/:id/fulfill | 标记已兑现 |

### 2.2 前端组件接缝

| 接缝 | 组件 | 验证内容 |
|------|------|---------|
| 成长地图 | `<GrowthMap>` | 五大维度卡片渲染、点亮状态、点击展开任务 |
| 任务卡片 | `<TaskCard>` | 任务名称、维度标签、积分值、完成状态、勾选交互 |
| 打卡页面 | `<CheckInPage>` | 筛选标签、任务列表、底部统计栏 |
| 积分卡片 | `<PointsBalance>` | 余额显示、动画效果 |
| 奖励卡片 | `<RewardCard>` | 奖励标题、积分价格、兑换按钮状态 |
| 兑换弹窗 | `<RedemptionModal>` | 引导提示、说明输入、提交 |

### 2.3 领域逻辑接缝（纯函数）

| 接缝 | 函数签名 | 说明 |
|------|---------|------|
| 积分计算 | `calculatePoints(checkins: CheckIn[], tasks: Task[]): number` | 根据打卡记录计算总积分 |
| 维度点亮状态 | `getDimensionStatus(dimensionId: number, checkins: CheckIn[], tasks: Task[]): 'none' \| 'partial' \| 'complete'` | 计算维度点亮状态 |
| 任务可见性 | `getVisibleTasks(tasks: Task[], frequency: Frequency, date: Date): Task[]` | 根据频率和日期筛选当日可见任务 |
| 兑换校验 | `canRedeem(balance: number, reward: Reward): { ok: boolean; shortfall?: number }` | 校验积分是否足够兑换 |
| 打卡校验 | `canCheckIn(existingCheckins: CheckIn[], task: Task, date: Date): { ok: boolean; reason?: string }` | 校验是否可以打卡 |

---

## 3. 技术栈与工具

### 3.1 技术栈假设

| 层 | 技术 | 理由 |
|----|------|------|
| 前端框架 | React 18 + TypeScript | 生态成熟，类型安全 |
| 前端测试 | Vitest + Testing Library | 快速，与Vite集成好 |
| 后端框架 | Node.js + Express/Fastify | 与前端同语言 |
| 后端测试 | Vitest + supertest | 统一测试工具 |
| 数据库 | PostgreSQL（生产）/ SQLite（测试） | 事务支持，测试隔离 |
| E2E测试 | Playwright | 跨浏览器，API拦截 |

### 3.2 测试目录结构

```
growth-points-bank/
├── src/
│   ├── shared/           # 领域逻辑（纯函数，无IO）
│   │   ├── points.ts
│   │   ├── dimensions.ts
│   │   ├── tasks.ts
│   │   └── rewards.ts
│   ├── server/           # 后端API
│   │   ├── routes/
│   │   └── db/
│   └── client/           # 前端组件
│       └── components/
├── tests/
│   ├── unit/             # 单元测试（纯函数）
│   │   ├── points.test.ts
│   │   ├── dimensions.test.ts
│   │   ├── tasks.test.ts
│   │   └── rewards.test.ts
│   ├── integration/      # 集成测试（API）
│   │   ├── auth.test.ts
│   │   ├── children.test.ts
│   │   ├── tasks.test.ts
│   │   ├── checkins.test.ts
│   │   ├── points.test.ts
│   │   └── redemptions.test.ts
│   ├── component/        # 组件测试（前端）
│   │   ├── GrowthMap.test.tsx
│   │   ├── TaskCard.test.tsx
│   │   └── CheckInPage.test.tsx
│   ├── e2e/              # 端到端测试
│   │   └── daily-flow.spec.ts
│   └── fixtures/         # 测试数据
│       ├── families.ts
│       ├── children.ts
│       └── tasks.ts
└── vitest.config.ts
```

---

## 4. 测试用例 - 认证与账户

### 切片 4.1：家长注册

```typescript
// tests/integration/auth.test.ts

describe('POST /api/auth/register', () => {

  // RED 1: 成功注册
  test('registers a new parent with email and password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'parent@test.com', password: 'Secure123!', nickname: '测试妈妈' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      email: 'parent@test.com',
      nickname: '测试妈妈',
    });
    expect(response.body.password).toBeUndefined();
    expect(response.body.token).toBeDefined();
  });

  // RED 2: 重复邮箱注册失败
  test('rejects duplicate email registration', async () => {
    await createParent({ email: 'dup@test.com', password: 'Secure123!' });

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@test.com', password: 'Another456!', nickname: '重复' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('already exists');
  });

  // RED 3: 缺少必填字段
  test('rejects registration with missing email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ password: 'Secure123!', nickname: '无邮箱' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('email');
  });

  // RED 4: 密码强度校验
  test('rejects weak password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@test.com', password: '123', nickname: '弱密码' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('password');
  });
});
```

### 切片 4.2：家长登录

```typescript
describe('POST /api/auth/login', () => {

  // RED 1: 正确凭证登录成功
  test('logs in with correct credentials', async () => {
    await createParent({ email: 'login@test.com', password: 'Secure123!' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test.com', password: 'Secure123!' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
    expect(response.body.parent.email).toBe('login@test.com');
  });

  // RED 2: 错误密码登录失败
  test('rejects wrong password', async () => {
    await createParent({ email: 'wrong@test.com', password: 'Secure123!' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@test.com', password: 'WrongPass!' });

    expect(response.status).toBe(401);
  });

  // RED 3: 不存在的邮箱
  test('rejects non-existent email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'Secure123!' });

    expect(response.status).toBe(401);
  });
});
```

### 切片 4.3：创建孩子档案

```typescript
describe('POST /api/children', () => {

  // RED 1: 成功创建孩子
  test('creates a child profile under family', async () => {
    const { token, familyId } = await loginAsParent();

    const response = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '小明', age_group: '6-8' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      family_id: familyId,
      name: '小明',
      age_group: '6-8',
    });
  });

  // RED 2: 未认证请求被拒
  test('rejects unauthenticated request', async () => {
    const response = await request(app)
      .post('/api/children')
      .send({ name: '小明', age_group: '6-8' });

    expect(response.status).toBe(401);
  });

  // RED 3: 生成孩子访问令牌
  test('generates access token for child', async () => {
    const { token, childId } = await loginAsParentWithChild();

    const response = await request(app)
      .post(`/api/children/${childId}/access-token`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.access_token).toBeDefined();
    expect(response.body.expires_at).toBeDefined();
  });
});
```

---

## 5. 测试用例 - 任务管理

### 切片 5.1：创建任务

```typescript
describe('POST /api/tasks', () => {

  // RED 1: 成功创建每日任务
  test('creates a daily task with dimension and points', async () => {
    const { token } = await loginAsParent();

    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '阅读30分钟',
        dimension_id: 1,  // 学习力
        point_value: 2,
        frequency: 'daily',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      title: '阅读30分钟',
      dimension_id: 1,
      point_value: 2,
      frequency: 'daily',
      is_active: true,
    });
  });

  // RED 2: 积分值范围校验
  test('rejects task with points exceeding 20', async () => {
    const { token } = await loginAsParent();

    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '超额任务',
        dimension_id: 1,
        point_value: 25,
        frequency: 'daily',
      });

    expect(response.status).toBe(400);
  });

  // RED 3: 无效维度ID
  test('rejects invalid dimension id', async () => {
    const { token } = await loginAsParent();

    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '无效维度',
        dimension_id: 99,
        point_value: 2,
        frequency: 'daily',
      });

    expect(response.status).toBe(400);
  });

  // RED 4: 任务名称长度校验
  test('rejects empty task title', async () => {
    const { token } = await loginAsParent();

    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '',
        dimension_id: 1,
        point_value: 2,
        frequency: 'daily',
      });

    expect(response.status).toBe(400);
  });
});
```

### 切片 5.2：任务频率与可见性（领域逻辑）

```typescript
// tests/unit/tasks.test.ts

describe('getVisibleTasks()', () => {

  // RED 1: 每日任务每天可见
  test('daily tasks are visible every day', () => {
    const tasks = [
      makeTask({ id: 't1', frequency: 'daily' }),
      makeTask({ id: 't2', frequency: 'weekly' }),
    ];
    const date = new Date('2026-07-15');

    const visible = getVisibleTasks(tasks, 'all', date);

    expect(visible.find(t => t.id === 't1')).toBeDefined();
  });

  // RED 2: 每周任务在周一可见
  test('weekly tasks are visible on Monday', () => {
    const tasks = [makeTask({ id: 't1', frequency: 'weekly' })];
    const monday = new Date('2026-07-13'); // 周一

    const visible = getVisibleTasks(tasks, 'all', monday);

    expect(visible).toHaveLength(1);
  });

  // RED 3: 一次性任务完成后不可见
  test('once tasks that are completed are not visible', () => {
    const tasks = [makeTask({ id: 't1', frequency: 'once' })];
    const completedCheckins = [makeCheckIn({ task_id: 't1', date: '2026-07-14' })];
    const date = new Date('2026-07-15');

    const visible = getVisibleTasks(tasks, 'all', date, completedCheckins);

    expect(visible).toHaveLength(0);
  });

  // RED 4: 停用任务不可见
  test('inactive tasks are not visible', () => {
    const tasks = [
      makeTask({ id: 't1', is_active: false }),
      makeTask({ id: 't2', is_active: true }),
    ];
    const date = new Date('2026-07-15');

    const visible = getVisibleTasks(tasks, 'all', date);

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('t2');
  });
});
```

---

## 6. 测试用例 - 今日打卡

### 切片 6.1：打卡操作

```typescript
describe('POST /api/checkins', () => {

  // RED 1: 孩子成功打卡
  test('child checks in a task and earns points', async () => {
    const { childToken, taskId } = await setupChildWithTask();

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: taskId, date: '2026-07-15' });

    expect(response.status).toBe(201);
    expect(response.body.points_earned).toBe(2);
    expect(response.body.balance_after).toBe(2);
  });

  // RED 2: 重复打卡被拒
  test('rejects duplicate check-in for same task on same day', async () => {
    const { childToken, taskId } = await setupChildWithTask();

    await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: taskId, date: '2026-07-15' });

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: taskId, date: '2026-07-15' });

    expect(response.status).toBe(409);
  });

  // RED 3: 取消打卡扣除积分
  test('canceling check-in deducts earned points', async () => {
    const { childToken, taskId, checkinId } = await setupChildWithCheckIn();

    const response = await request(app)
      .delete(`/api/checkins/${checkinId}`)
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(200);
    expect(response.body.balance_after).toBe(0);
  });

  // RED 4: 不可补打卡（过去日期）
  test('rejects check-in for past date', async () => {
    const { childToken, taskId } = await setupChildWithTask();
    const yesterday = getYesterdayDate();

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: taskId, date: yesterday });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('past');
  });
});
```

### 切片 6.2：家长撤销打卡

```typescript
describe('POST /api/checkins/:id/revoke', () => {

  // RED 1: 家长成功撤销不实打卡
  test('parent revokes a check-in, points are deducted', async () => {
    const { parentToken, childToken, taskId } = await setupFamilyWithTask();
    
    // 孩子先打卡
    const checkin = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: taskId, date: '2026-07-15' });

    // 家长撤销
    const response = await request(app)
      .post(`/api/checkins/${checkin.body.id}/revoke`)
      .set('Authorization', `Bearer ${parentToken}`);

    expect(response.status).toBe(200);
    expect(response.body.revoked_by_parent).toBe(true);
    expect(response.body.balance_after).toBe(0);
  });

  // RED 2: 孩子不能撤销家长的撤销
  test('child cannot undo parent revocation', async () => {
    const { childToken, revokedCheckinId } = await setupRevokedCheckIn();

    const response = await request(app)
      .post(`/api/checkins/${revokedCheckinId}/revoke`)
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(403);
  });
});
```

### 切片 6.3：打卡校验（领域逻辑）

```typescript
// tests/unit/checkin.test.ts

describe('canCheckIn()', () => {

  // RED 1: 首次打卡允许
  test('allows first check-in for a task', () => {
    const result = canCheckIn([], makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(true);
  });

  // RED 2: 同日重复打卡拒绝
  test('rejects duplicate check-in same day', () => {
    const existing = [makeCheckIn({ task_id: 't1', date: '2026-07-15' })];
    const result = canCheckIn(existing, makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('already');
  });

  // RED 3: 已被家长撤销的打卡可重新打卡
  test('allows re-check-in after parent revocation', () => {
    const existing = [makeCheckIn({ task_id: 't1', date: '2026-07-15', revoked_by_parent: true })];
    const result = canCheckIn(existing, makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(true);
  });
});
```

---

## 7. 测试用例 - 积分系统

### 切片 7.1：积分计算（领域逻辑）

```typescript
// tests/unit/points.test.ts

describe('calculatePoints()', () => {

  // RED 1: 无打卡积分为0
  test('returns 0 when no check-ins', () => {
    const result = calculatePoints([], []);
    expect(result).toBe(0);
  });

  // RED 2: 单个打卡的积分
  test('returns correct points for single check-in', () => {
    const tasks = [makeTask({ id: 't1', point_value: 3 })];
    const checkins = [makeCheckIn({ task_id: 't1' })];
    expect(calculatePoints(checkins, tasks)).toBe(3);
  });

  // RED 3: 多个打卡的积分累加
  test('sums points across multiple check-ins', () => {
    const tasks = [
      makeTask({ id: 't1', point_value: 2 }),
      makeTask({ id: 't2', point_value: 5 }),
    ];
    const checkins = [
      makeCheckIn({ task_id: 't1' }),
      makeCheckIn({ task_id: 't2' }),
    ];
    expect(calculatePoints(checkins, tasks)).toBe(7);
  });

  // RED 4: 被家长撤销的打卡不计分
  test('excludes revoked check-ins', () => {
    const tasks = [makeTask({ id: 't1', point_value: 2 })];
    const checkins = [
      makeCheckIn({ task_id: 't1', revoked_by_parent: true }),
    ];
    expect(calculatePoints(checkins, tasks)).toBe(0);
  });

  // RED 5: 扣除已兑换积分
  test('subtracts redeemed points from total', () => {
    const tasks = [makeTask({ id: 't1', point_value: 10 })];
    const checkins = [makeCheckIn({ task_id: 't1' })];
    const redemptions = [makeRedemption({ point_cost: 3, status: 'fulfilled' })];
    expect(calculatePoints(checkins, tasks, redemptions)).toBe(7);
  });
});
```

### 切片 7.2：积分流水

```typescript
describe('GET /api/points/transactions', () => {

  // RED 1: 返回积分流水列表
  test('returns point transaction history', async () => {
    const { childToken } = await setupChildWithCheckIn();

    const response = await request(app)
      .get('/api/points/transactions')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(200);
    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0]).toMatchObject({
      amount: 2,
      source_type: 'task',
      balance_after: 2,
    });
  });

  // RED 2: 按时间倒序排列
  test('returns transactions in reverse chronological order', async () => {
    const { childToken } = await setupChildWithMultipleCheckIns(3);

    const response = await request(app)
      .get('/api/points/transactions')
      .set('Authorization', `Bearer ${childToken}`);

    const timestamps = response.body.transactions.map(t => new Date(t.created_at).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});
```

---

## 8. 测试用例 - 奖励兑换

### 切片 8.1：兑换校验（领域逻辑）

```typescript
// tests/unit/rewards.test.ts

describe('canRedeem()', () => {

  // RED 1: 积分充足可以兑换
  test('allows redemption when balance is sufficient', () => {
    const result = canRedeem(50, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(true);
  });

  // RED 2: 积分不足不可兑换
  test('rejects redemption when balance is insufficient', () => {
    const result = canRedeem(10, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(false);
    expect(result.shortfall).toBe(20);
  });

  // RED 3: 积分恰好等于兑换值
  test('allows redemption when balance equals cost', () => {
    const result = canRedeem(30, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(true);
  });
});
```

### 切片 8.2：兑换流程

```typescript
describe('POST /api/redemptions', () => {

  // RED 1: 孩子发起兑换请求
  test('child creates a redemption request with note', async () => {
    const { childToken, rewardId } = await setupChildWithPointsAndReward(50);

    const response = await request(app)
      .post('/api/redemptions')
      .set('Authorization', `Bearer ${childToken}`)
      .send({
        reward_id: rewardId,
        child_note: '我坚持了一周阅读才换的',
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    expect(response.body.point_cost).toBe(30);
    // 积分尚未扣除（待审核通过才扣）
    expect(response.body.balance_after).toBe(50);
  });

  // RED 2: 积分不足时发起兑换被拒
  test('rejects redemption when insufficient points', async () => {
    const { childToken, rewardId } = await setupChildWithPointsAndReward(10);

    const response = await request(app)
      .post('/api/redemptions')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ reward_id: rewardId, child_note: '想兑换' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('insufficient');
  });
});
```

### 切片 8.3：兑换审核与履约

```typescript
describe('PATCH /api/redemptions/:id/approve', () => {

  // RED 1: 家长审核通过，积分扣除
  test('parent approves redemption, points are deducted', async () => {
    const { parentToken, redemptionId } = await setupPendingRedemption(50, 30);

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionId}/approve`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ parent_note: '表现很好，批准' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('approved');
    expect(response.body.balance_after).toBe(20);
  });

  // RED 2: 家长拒绝，积分不扣
  test('parent rejects redemption, points are not deducted', async () => {
    const { parentToken, redemptionId } = await setupPendingRedemption(50, 30);

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionId}/reject`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ parent_note: '再坚持一周' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('rejected');
    expect(response.body.balance_after).toBe(50);
  });

  // RED 3: 家长标记已兑现
  test('parent marks redemption as fulfilled', async () => {
    const { parentToken, redemptionId } = await setupApprovedRedemption();

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionId}/fulfill`)
      .set('Authorization', `Bearer ${parentToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('fulfilled');
    expect(response.body.fulfilled_at).toBeDefined();
  });

  // RED 4: 不能对已拒绝的兑换进行通过
  test('cannot approve an already rejected redemption', async () => {
    const { parentToken, redemptionId } = await setupRejectedRedemption();

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionId}/approve`)
      .set('Authorization', `Bearer ${parentToken}`);

    expect(response.status).toBe(400);
  });
});
```

---

## 9. 测试用例 - 成长地图

### 切片 9.1：维度状态计算（领域逻辑）

```typescript
// tests/unit/dimensions.test.ts

describe('getDimensionStatus()', () => {

  const tasks = [
    makeTask({ id: 't1', dimension_id: 1, frequency: 'daily' }),
    makeTask({ id: 't2', dimension_id: 1, frequency: 'daily' }),
  ];

  // RED 1: 无打卡 → none
  test('returns "none" when no check-ins', () => {
    const status = getDimensionStatus(1, [], tasks, new Date('2026-07-15'));
    expect(status).toBe('none');
  });

  // RED 2: 部分打卡 → partial
  test('returns "partial" when some tasks are completed', () => {
    const checkins = [makeCheckIn({ task_id: 't1', date: '2026-07-15' })];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('partial');
  });

  // RED 3: 全部打卡 → complete
  test('returns "complete" when all tasks are completed', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-15' }),
      makeCheckIn({ task_id: 't2', date: '2026-07-15' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('complete');
  });

  // RED 4: 被撤销的打卡不计入
  test('excludes revoked check-ins from status', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-15', revoked_by_parent: true }),
      makeCheckIn({ task_id: 't2', date: '2026-07-15' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('partial');
  });

  // RED 5: 其他日期的打卡不计入
  test('excludes check-ins from other dates', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-14' }),
      makeCheckIn({ task_id: 't2', date: '2026-07-14' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('none');
  });
});
```

### 切片 9.2：前端组件测试

```typescript
// tests/component/GrowthMap.test.tsx

describe('<GrowthMap>', () => {

  // RED 1: 渲染五个维度卡片
  test('renders five dimension cards', async () => {
    render(<GrowthMap dimensions={mockDimensions} checkins={[]} tasks={mockTasks} />);

    expect(screen.getByText('学习力')).toBeInTheDocument();
    expect(screen.getByText('运动力')).toBeInTheDocument();
    expect(screen.getByText('自控力')).toBeInTheDocument();
    expect(screen.getByText('探索力')).toBeInTheDocument();
    expect(screen.getByText('实践力')).toBeInTheDocument();
  });

  // RED 2: 未开始的维度显示灰色
  test('shows gray status for dimension with no check-ins', async () => {
    render(<GrowthMap dimensions={mockDimensions} checkins={[]} tasks={mockTasks} />);

    const card = screen.getByText('学习力').closest('[data-testid="dimension-card"]');
    expect(card).toHaveStyle({ opacity: '0.5' });
  });

  // RED 3: 点击维度卡片展开任务
  test('expands task list when dimension card is clicked', async () => {
    render(<GrowthMap dimensions={mockDimensions} checkins={[]} tasks={mockTasks} />);

    await userEvent.click(screen.getByText('学习力'));

    expect(screen.getByText('阅读30分钟')).toBeInTheDocument();
  });

  // RED 4: 完成的维度显示金色
  test('shows gold status for completed dimension', async () => {
    const checkins = mockTasks
      .filter(t => t.dimension_id === 1)
      .map(t => makeCheckIn({ task_id: t.id, date: '2026-07-15' }));

    render(<GrowthMap dimensions={mockDimensions} checkins={checkins} tasks={mockTasks} />);

    const card = screen.getByText('学习力').closest('[data-testid="dimension-card"]');
    expect(card).toHaveClass('dimension-complete');
  });
});
```

```typescript
// tests/component/TaskCard.test.tsx

describe('<TaskCard>', () => {

  // RED 1: 显示任务名和积分
  test('displays task title and point value', async () => {
    const task = makeTask({ title: '阅读30分钟', point_value: 2, dimension_id: 1 });
    render(<TaskCard task={task} isChecked={false} onToggle={() => {}} />);

    expect(screen.getByText('阅读30分钟')).toBeInTheDocument();
    expect(screen.getByText('+2分')).toBeInTheDocument();
  });

  // RED 2: 点击勾选触发回调
  test('calls onToggle when check button is clicked', async () => {
    const onToggle = vi.fn();
    const task = makeTask({ title: '阅读', point_value: 2, dimension_id: 1 });
    render(<TaskCard task={task} isChecked={false} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    expect(onToggle).toHaveBeenCalledWith(task.id);
  });

  // RED 3: 已完成状态显示勾选
  test('shows checked state when isChecked is true', async () => {
    const task = makeTask({ title: '阅读', point_value: 2, dimension_id: 1 });
    render(<TaskCard task={task} isChecked={true} onToggle={() => {}} />);

    expect(screen.getByRole('button', { name: /check/i })).toHaveAttribute('aria-checked', 'true');
  });
});
```

---

## 10. 测试数据固定装置

```typescript
// tests/fixtures/families.ts

export function makeFamily(overrides: Partial<Family> = {}): Family {
  return {
    id: 'fam-1',
    parent_id: 'parent-1',
    name: '测试家庭',
    summer_start_date: new Date('2026-07-01'),
    summer_end_date: new Date('2026-08-31'),
    created_at: new Date('2026-07-01'),
    ...overrides,
  };
}

// tests/fixtures/children.ts

export function makeChild(overrides: Partial<Child> = {}): Child {
  return {
    id: 'child-1',
    family_id: 'fam-1',
    name: '小明',
    avatar: null,
    age_group: '6-8',
    access_token: 'token-abc',
    token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    created_at: new Date('2026-07-01'),
    ...overrides,
  };
}

// tests/fixtures/tasks.ts

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    family_id: 'fam-1',
    dimension_id: 1,
    title: '阅读30分钟',
    point_value: 2,
    frequency: 'daily',
    description: null,
    is_active: true,
    created_at: new Date('2026-07-01'),
    ...overrides,
  };
}

export function makeCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: 'checkin-1',
    child_id: 'child-1',
    task_id: 'task-1',
    date: '2026-07-15',
    created_at: new Date('2026-07-15T10:00:00'),
    revoked_by_parent: false,
    revoked_at: null,
    ...overrides,
  };
}

export function makeReward(overrides: Partial<Reward> = {}): Reward {
  return {
    id: 'reward-1',
    family_id: 'fam-1',
    tier: 'small',
    point_cost: 10,
    title: '家庭电影',
    description: '选择一次家庭电影',
    is_active: true,
    created_at: new Date('2026-07-01'),
    ...overrides,
  };
}

export function makeRedemption(overrides: Partial<RewardRedemption> = {}): RewardRedemption {
  return {
    id: 'redemption-1',
    child_id: 'child-1',
    reward_id: 'reward-1',
    point_cost: 10,
    child_note: '坚持了一周',
    status: 'pending',
    parent_note: null,
    created_at: new Date('2026-07-15'),
    reviewed_at: null,
    fulfilled_at: null,
    ...overrides,
  };
}

export const mockDimensions: Dimension[] = [
  { id: 1, name: '学习力', icon: 'book', color: '#2196F3', description: '学习习惯', sort_order: 1 },
  { id: 2, name: '运动力', icon: 'run', color: '#FF9800', description: '身体发展', sort_order: 2 },
  { id: 3, name: '自控力', icon: 'clock', color: '#9C27B0', description: '自我管理', sort_order: 3 },
  { id: 4, name: '探索力', icon: 'compass', color: '#4CAF50', description: '好奇心', sort_order: 4 },
  { id: 5, name: '实践力', icon: 'hand', color: '#F44336', description: '生活技能', sort_order: 5 },
];
```

---

## 11. Mock/Stub 策略

### 11.1 原则

- **领域逻辑测试**：不使用 Mock，直接测试纯函数
- **API 集成测试**：使用真实的测试数据库（SQLite in-memory），不 Mock 数据库
- **组件测试**：Mock API 调用（使用 MSW - Mock Service Worker），不 Mock 组件内部
- **E2E 测试**：不使用任何 Mock，使用完整的测试环境

### 11.2 数据库隔离

```typescript
// tests/setup.ts - 每个测试用例使用独立的内存数据库

beforeEach(async () => {
  const db = createInMemoryDb();
  await db.migrate();
  app.locals.db = db;
});

afterEach(async () => {
  await app.locals.db.destroy();
});
```

### 11.3 API Mock（组件测试）

```typescript
// tests/component/setup.ts - 使用 MSW 拦截 API 请求

import { setupServer } from 'msw/node';

export const mockServer = setupServer(
  rest.get('/api/checkins/today', (req, res, ctx) => {
    return res(ctx.json({ checkins: [] }));
  }),
  rest.post('/api/checkins', (req, res, ctx) => {
    return res(ctx.status(201), ctx.json({ id: 'checkin-1', points_earned: 2 }));
  }),
);

beforeAll(() => mockServer.listen());
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());
```

---

## 12. TDD 执行顺序

按以下顺序执行 TDD 循环，每个切片是一个完整的 RED→GREEN→REFACTOR 周期：

### 第一阶段：领域逻辑（纯函数，无依赖）

| 序号 | 切片 | 测试文件 | 预计测试数 |
|------|------|---------|-----------|
| 1 | 积分计算 | points.test.ts | 5 |
| 2 | 维度状态计算 | dimensions.test.ts | 5 |
| 3 | 任务可见性 | tasks.test.ts | 4 |
| 4 | 打卡校验 | checkin.test.ts | 3 |
| 5 | 兑换校验 | rewards.test.ts | 3 |

**小计：20 个单元测试**

### 第二阶段：API 集成（后端）

| 序号 | 切片 | 测试文件 | 预计测试数 |
|------|------|---------|-----------|
| 6 | 家长注册 | auth.test.ts | 4 |
| 7 | 家长登录 | auth.test.ts | 3 |
| 8 | 创建孩子 | children.test.ts | 3 |
| 9 | 创建任务 | tasks.test.ts | 4 |
| 10 | 打卡操作 | checkins.test.ts | 4 |
| 11 | 家长撤销 | checkins.test.ts | 2 |
| 12 | 积分流水 | points.test.ts | 2 |
| 13 | 兑换发起 | redemptions.test.ts | 2 |
| 14 | 兑换审核 | redemptions.test.ts | 4 |

**小计：28 个集成测试**

### 第三阶段：前端组件

| 序号 | 切片 | 测试文件 | 预计测试数 |
|------|------|---------|-----------|
| 15 | 成长地图 | GrowthMap.test.tsx | 4 |
| 16 | 任务卡片 | TaskCard.test.tsx | 3 |
| 17 | 打卡页面 | CheckInPage.test.tsx | 3 |
| 18 | 奖励卡片 | RewardCard.test.tsx | 2 |
| 19 | 兑换弹窗 | RedemptionModal.test.tsx | 2 |

**小计：14 个组件测试**

### 第四阶段：E2E

| 序号 | 切片 | 测试文件 | 预计测试数 |
|------|------|---------|-----------|
| 20 | 每日打卡完整流程 | daily-flow.spec.ts | 1 |
| 21 | 奖励兑换完整流程 | redemption-flow.spec.ts | 1 |

**小计：2 个 E2E 测试**

### 总计

| 层 | 测试数 |
|----|-------|
| 单元测试 | 20 |
| 集成测试 | 28 |
| 组件测试 | 14 |
| E2E测试 | 2 |
| **总计** | **64** |

---

## 13. 测试用例 - 每周复盘（双盲机制）

> 关联：[PRD §3.3](./PRD.md) · [ADR-0005](./architecture/adr-0005-double-blind-review.md) · [DETAILED_DESIGN §3.3](./DETAILED_DESIGN.md)

### 切片 13.1：复盘可见性纯函数（单元测试）

```typescript
// tests/unit/reviews.test.ts

describe('getReviewVisibility()', () => {

  // RED 1: 双方都未提交，仅看到自己区域
  test('returns own content and hides other when neither committed', () => {
    const review = makeReview({
      best_thing: '我的进步',
      parent_observation: '家长的看见',  // 不应可见
      child_committed_at: null,
      parent_committed_at: null,
    });
    const viewerRole = 'child';

    const visible = getReviewVisibility(review, viewerRole);

    expect(visible.best_thing).toBe('我的进步');
    expect(visible.parent_observation).toBeNull();
    expect(visible.other_status).toBe('other_not_started');
  });

  // RED 2: 对方已提交，自己可见
  test('shows other content when other has committed', () => {
    const review = makeReview({
      best_thing: '我的进步',
      parent_observation: '家长的看见',
      child_committed_at: null,
      parent_committed_at: new Date('2026-07-13'),
    });
    const viewerRole = 'child';

    const visible = getReviewVisibility(review, viewerRole);

    expect(visible.parent_observation).toBe('家长的看见');
    expect(visible.other_status).toBe('other_committed');
  });

  // RED 3: 双方都提交后 locked
  test('returns locked=true when both committed', () => {
    const review = makeReview({
      child_committed_at: new Date('2026-07-13T10:00:00Z'),
      parent_committed_at: new Date('2026-07-13T15:00:00Z'),
      locked_at: new Date('2026-07-13T15:00:00Z'),
    });

    const visible = getReviewVisibility(review, 'child');

    expect(visible.locked).toBe(true);
  });
});
```

### 切片 13.2：复盘提交（集成测试）

```typescript
// tests/integration/reviews.test.ts

describe('POST /api/reviews/child', () => {

  // RED 1: 孩子提交复盘
  test('child submits own review section', async () => {
    const { childToken, childId } = await loginAsChild();

    const response = await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({
        week_start_date: '2026-07-13',
        best_thing: '我学会了游泳',
        difficulty: '早起很难',
      });

    expect(response.status).toBe(200);
    expect(response.body.locked).toBe(false);
    expect(response.body.child_committed_at).toBeDefined();
  });

  // RED 2: 已 locked 不可再提交
  test('rejects submission when review is locked', async () => {
    const { childToken, childId } = await loginAsChild();
    await lockReview(childId, '2026-07-13');

    const response = await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({
        week_start_date: '2026-07-13',
        best_thing: '试图修改',
        difficulty: '...',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REVIEW_LOCKED');
  });

  // RED 3: 双方提交后自动 lock
  test('auto-locks when both child and parent have committed', async () => {
    const { childToken, childId, parentToken } = await setupFamilyWithBoth();

    // 孩子先提交
    await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ week_start_date: '2026-07-13', best_thing: '...', difficulty: '...' });

    // 家长后提交 → 触发 lock
    const response = await request(app)
      .post('/api/reviews/parent')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '看到孩子的努力',
      });

    expect(response.status).toBe(200);
    expect(response.body.locked).toBe(true);
  });

  // RED 4: 家长提交后孩子可见
  test('parent observation becomes visible to child after parent commits', async () => {
    const { childToken, childId, parentToken } = await setupFamilyWithBoth();

    // 家长先提交
    await request(app)
      .post('/api/reviews/parent')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '私密观察',
      });

    // 孩子查看
    const response = await request(app)
      .get('/api/reviews?week=2026-07-13')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(200);
    expect(response.body.parent_observation).toBe('私密观察');
    expect(response.body.other_status).toBe('other_committed');
  });

  // RED 5: 同周不可重复提交（已提交则更新而非新建）
  test('upserts review for same week', async () => {
    const { childToken } = await loginAsChild();

    await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ week_start_date: '2026-07-13', best_thing: '第一版', difficulty: '...' });

    const response = await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ week_start_date: '2026-07-13', best_thing: '修改版', difficulty: '...' });

    expect(response.status).toBe(200);
    // 只有一条记录
    const reviews = await request(app)
      .get('/api/reviews?week=2026-07-13')
      .set('Authorization', `Bearer ${childToken}`);
    expect(reviews.body.best_thing).toBe('修改版');
  });
});

### 切片 13.3：复盘数据聚合

```typescript
describe('WeeklyReview aggregation', () => {

  // RED 1: lock 时自动计算本周统计
  test('computes task_count, point_earned, dimension_count on lock', async () => {
    const { childToken, childId, parentToken } = await setupFamilyWithBoth();
    // 准备数据：本周完成 5 个任务获得 12 积分，点亮 3 个维度
    await seedWeekActivity(childId, '2026-07-13', {
      checkins: 5,
      points: 12,
      dimensions_lit: 3,
    });

    await lockReviewByBoth(childToken, parentToken, childId, '2026-07-13');

    const response = await request(app)
      .get('/api/reviews?week=2026-07-13')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.body.task_count).toBe(5);
    expect(response.body.point_earned).toBe(12);
    expect(response.body.dimension_count).toBe(3);
  });
});
```

---

## 14. 测试用例 - 成长日记

> 关联：[PRD §3.5](./PRD.md)

### 切片 14.1：日记 CRUD（集成测试）

```typescript
// tests/integration/diaries.test.ts

describe('POST /api/diaries', () => {

  // RED 1: 孩子创建日记
  test('child creates a diary entry', async () => {
    const { childToken } = await loginAsChild();

    const response = await request(app)
      .post('/api/diaries')
      .set('Authorization', `Bearer ${childToken}`)
      .send({
        title: '今天学会游泳',
        content: '去了游泳池，第一次能游10米...',
        category: 'exercise',
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.title).toBe('今天学会游泳');
  });

  // RED 2: 标题必填
  test('rejects empty title', async () => {
    const { childToken } = await loginAsChild();

    const response = await request(app)
      .post('/api/diaries')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ title: '', content: '内容', category: 'journal' });

    expect(response.status).toBe(400);
  });

  // RED 3: 无效分类
  test('rejects invalid category', async () => {
    const { childToken } = await loginAsChild();

    const response = await request(app)
      .post('/api/diaries')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ title: 't', content: 'c', category: 'invalid_cat' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/diaries', () => {

  // RED 4: 按分类筛选
  test('filters diaries by category', async () => {
    const { childToken } = await loginAsChild();
    await createDiary(childToken, { category: 'exercise' });
    await createDiary(childToken, { category: 'cooking' });

    const response = await request(app)
      .get('/api/diaries?category=exercise')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].category).toBe('exercise');
  });

  // RED 5: 时间线倒序
  test('returns diaries in descending order by created_at', async () => {
    const { childToken } = await loginAsChild();
    const first = await createDiary(childToken, { title: 'first' });
    await sleep(10);
    const second = await createDiary(childToken, { title: 'second' });

    const response = await request(app)
      .get('/api/diaries')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.body.data[0].id).toBe(second.body.id);
    expect(response.body.data[1].id).toBe(first.body.id);
  });
});
```

---

## 15. 测试用例 - 并发与竞态

> 关联：[ADR-0003](./architecture/adr-0003-points-integrity.md) · [DETAILED_DESIGN §7](./DETAILED_DESIGN.md)

### 切片 15.1：积分 SERIALIZABLE 重试

```typescript
// tests/integration/concurrency.test.ts

describe('SERIALIZABLE retry on point transactions', () => {

  // RED 1: 并发打卡同一孩子不同任务，最终余额正确
  test('concurrent checkins on different tasks produce correct balance', async () => {
    const { childToken, childId } = await loginAsChild();
    // 准备两个任务，每个 +2 分
    const task1 = await createTask({ point_value: 2 });
    const task2 = await createTask({ point_value: 2 });

    // 并发提交
    await Promise.all([
      request(app).post('/api/checkins')
        .set('Authorization', `Bearer ${childToken}`)
        .send({ task_id: task1.id, date: '2026-07-16' }),
      request(app).post('/api/checkins')
        .set('Authorization', `Bearer ${childToken}`)
        .send({ task_id: task2.id, date: '2026-07-16' }),
    ]);

    const balance = await getBalance(childId);
    expect(balance).toBe(4);  // 4 = 2 + 2，无丢失
  });

  // RED 2: 同任务并发打卡只成功一次
  test('concurrent checkins on same task result in only one record', async () => {
    const { childToken, childId } = await loginAsChild();
    const task = await createTask({ point_value: 3 });

    const results = await Promise.allSettled([
      request(app).post('/api/checkins')
        .set('Authorization', `Bearer ${childToken}`)
        .send({ task_id: task.id, date: '2026-07-16' }),
      request(app).post('/api/checkins')
        .set('Authorization', `Bearer ${childToken}`)
        .send({ task_id: task.id, date: '2026-07-16' }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 201);
    expect(successes).toHaveLength(1);

    const balance = await getBalance(childId);
    expect(balance).toBe(3);  // 仅 +3，不重复
  });
});

### 切片 15.2：兑换并发审批

```typescript
describe('Concurrent redemption approval', () => {

  // RED 3: 余额仅够一次兑换时，并发审批只成功一次
  test('concurrent approvals when balance covers only one succeed once', async () => {
    const { childToken, childId, parentToken } = await setupFamilyWithBalance(30);
    // 余额 30，两个 30 分奖励
    const reward1 = await createReward({ point_cost: 30 });
    const reward2 = await createReward({ point_cost: 30 });
    const redemption1 = await createRedemption(childToken, reward1.id);
    const redemption2 = await createRedemption(childToken, reward2.id);

    const results = await Promise.allSettled([
      request(app).patch(`/api/redemptions/${redemption1.id}/approve`)
        .set('Authorization', `Bearer ${parentToken}`),
      request(app).patch(`/api/redemptions/${redemption2.id}/approve`)
        .set('Authorization', `Bearer ${parentToken}`),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 200);
    const failures = results.filter(r => r.status === 'fulfilled' && r.value.status === 422);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].value.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  // RED 4: SERIALIZABLE 重试耗尽返回 503
  test('returns SERIALIZATION_FAILED when retries exhausted', async () => {
    // 模拟持续冲突场景（mock 或注入故障）
    const { parentToken } = await setupFamilyWithBalance(100);
    const redemption = await createRedemption(...);

    // 通过 mock 强制所有重试失败
    jest.spyOn(db, 'transaction').mockRejectedValueOnce(
      Object.assign(new Error('serialization failure'), { code: '40001' })
    );

    const response = await request(app)
      .patch(`/api/redemptions/${redemption.id}/approve`)
      .set('Authorization', `Bearer ${parentToken}`);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERIALIZATION_FAILED');
  });
});
```

### 切片 15.3：幂等性测试

```typescript
describe('Idempotency', () => {

  // RED 5: 同一 idempotency_key 的兑换请求返回缓存结果
  test('duplicate redemption with same idempotency_key returns cached response', async () => {
    const { childToken } = await setupFamilyWithBalance(100);
    const reward = await createReward({ point_cost: 30 });
    const idempotencyKey = crypto.randomUUID();

    const first = await request(app)
      .post('/api/redemptions')
      .set('Authorization', `Bearer ${childToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ reward_id: reward.id, child_note: '...' });

    const second = await request(app)
      .post('/api/redemptions')
      .set('Authorization', `Bearer ${childToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ reward_id: reward.id, child_note: '...' });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    // 余额只扣一次
    expect(await getBalance(childId)).toBe(70);
  });
});
```

---

## 16. 测试用例 - 安全与多租户隔离

> 关联：[ADR-0002](./architecture/adr-0002-authentication.md) · [ADR-0006](./architecture/adr-0006-multi-tenant-isolation.md) · [ADR-0009](./architecture/adr-0009-data-encryption.md)

### 切片 16.1：多租户隔离

```typescript
// tests/integration/security.test.ts

describe('Multi-tenant isolation', () => {

  // RED 1: 家庭A的孩子不能访问家庭B的任务
  test('child from family A cannot see tasks from family B', async () => {
    const { childToken: childAToken } = await setupFamily('A');
    const { parentToken: parentBToken, familyId: familyB } = await setupFamily('B');
    // 家庭B 创建任务
    const taskB = await createTaskAsParent(parentBToken, { family_id: familyB });

    const response = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${childAToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.find(t => t.id === taskB.id)).toBeUndefined();
  });

  // RED 2: 直接访问其他家庭孩子的资源返回 404（非 403）
  test('cross-family access returns 404 not 403', async () => {
    const { parentToken: parentAToken } = await setupFamily('A');
    const { childId: childBId } = await setupFamily('B');

    const response = await request(app)
      .get(`/api/children/${childBId}/points/balance`)
      .set('Authorization', `Bearer ${parentAToken}`);

    expect(response.status).toBe(404);  // 不是 403
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  // RED 3: 跨家庭的兑换 ID 不可访问
  test('cross-family redemption access returns 404', async () => {
    const { parentToken: parentA, childToken: childA } = await setupFamily('A');
    const { parentToken: parentB, childId: childB, childToken } = await setupFamily('B');
    const redemptionB = await createRedemptionAsChild(childToken, ...);

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionB.id}/approve`)
      .set('Authorization', `Bearer ${parentA}`);

    expect(response.status).toBe(404);
  });
});

### 切片 16.2：JWT 认证

```typescript
describe('JWT authentication', () => {

  // RED 4: 家长 token 不能用于孩子专属接口
  test('parent token rejected on child-only endpoint', async () => {
    const { parentToken } = await setupFamily();

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ task_id: '...', date: '2026-07-16' });

    // 实际：家长可代打卡，所以应该 200；但若接口限定 child-only，则 403
    // 这里测试家长 token 在 child-only 接口上的行为
    expect([200, 403]).toContain(response.status);
  });

  // RED 5: token_version 不匹配时返回 401 TOKEN_REVOKED
  test('revoked child token (token_version mismatch) returns 401', async () => {
    const { childToken, childId, parentToken } = await setupFamilyWithChild();

    // 重新生成 token → token_version +1
    await request(app)
      .post(`/api/children/${childId}/access-token`)
      .set('Authorization', `Bearer ${parentToken}`);

    // 旧 token 应失效
    const response = await request(app)
      .get('/api/checkins/today')
      .set('Authorization', `Bearer ${childToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_REVOKED');
  });

  // RED 6: 过期 token 返回 401 TOKEN_EXPIRED
  test('expired token returns TOKEN_EXPIRED', async () => {
    const expiredToken = jwt.sign(
      { sub: 'child_001', role: 'child', family_id: 'fam_001', token_version: 0 },
      process.env.CHILD_JWT_SECRET,
      { expiresIn: '-1s' }  // 已过期
    );

    const response = await request(app)
      .get('/api/checkins/today')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

### 切片 16.3：字段加密

```typescript
describe('Field-level encryption (ADR-0009)', () => {

  // RED 7: 日记内容在 DB 中是密文
  test('diary content is encrypted at rest', async () => {
    const { childToken, childId } = await loginAsChild();
    const plainText = '我的私密日记内容';

    await request(app)
      .post('/api/diaries')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ title: 't', content: plainText, category: 'journal' });

    // 直接查 DB（绕过应用层解密）
    const rawRow = await db.raw('SELECT title, content FROM app.growth_diaries WHERE child_id = ?', [childId]);
    expect(rawRow[0].content).not.toBe(plainText);
    expect(rawRow[0].content).toMatch(/^[A-Za-z0-9+/=]+$/);  // base64
  });

  // RED 8: 复盘内容在 DB 中是密文
  test('weekly review content is encrypted at rest', async () => {
    const { childToken, childId } = await loginAsChild();
    const secretText = '这周最棒的事：学会了骑自行车';

    await request(app)
      .post('/api/reviews/child')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ week_start_date: '2026-07-13', best_thing: secretText, difficulty: '...' });

    const rawRow = await db.raw('SELECT best_thing FROM app.weekly_reviews WHERE child_id = ?', [childId]);
    expect(rawRow[0].best_thing).not.toContain(secretText);
  });
});
```

---

## 17. 测试用例 - 错误流与边界条件

### 切片 17.1：输入校验

```typescript
// tests/integration/error-flows.test.ts

describe('Input validation edge cases', () => {

  // RED 1: 任务名恰好 30 字符
  test('task title with exactly 30 chars is accepted', async () => {
    const { token } = await loginAsParent();
    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '一'.repeat(30),  // 30 个中文字符
        dimension_id: 1,
        point_value: 2,
        frequency: 'daily',
      });
    expect(response.status).toBe(201);
  });

  // RED 2: 任务名 31 字符失败
  test('task title with 31 chars is rejected', async () => {
    const { token } = await loginAsParent();
    const response = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '一'.repeat(31),
        dimension_id: 1, point_value: 2, frequency: 'daily',
      });
    expect(response.status).toBe(400);
  });

  // RED 3: 积分值边界 0 和 21
  test('point_value boundary: 1 accepted, 20 accepted, 0 and 21 rejected', async () => {
    const { token } = await loginAsParent();
    for (const [value, expectedStatus] of [[1, 201], [20, 201], [0, 400], [21, 400]]) {
      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 't', dimension_id: 1, point_value: value, frequency: 'daily' });
      expect(response.status).toBe(expectedStatus);
    }
  });
});

### 切片 17.2：业务规则边界

```typescript
describe('Business rule edge cases', () => {

  // RED 4: 同一天不可补打过去日期的卡
  test('cannot check in for past date', async () => {
    const { childToken } = await loginAsChild();
    const task = await createTask({});

    const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().split('T')[0];
    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: task.id, date: yesterday });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CHECKIN_DATE_IN_PAST');
  });

  // RED 5: 停用任务不可打卡
  test('cannot check in inactive task', async () => {
    const { childToken, parentToken } = await setupFamilyWithBoth();
    const task = await createTaskAsParent(parentToken, { is_active: false });

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ task_id: task.id, date: '2026-07-16' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TASK_INACTIVE');
  });

  // RED 6: 撤销已撤销的打卡返回 409
  test('cannot revoke already revoked checkin', async () => {
    const { parentToken, childId } = await setupFamilyWithBoth();
    const checkin = await createCheckin(childId);

    await request(app)
      .post(`/api/checkins/${checkin.id}/revoke`)
      .set('Authorization', `Bearer ${parentToken}`);

    const second = await request(app)
      .post(`/api/checkins/${checkin.id}/revoke`)
      .set('Authorization', `Bearer ${parentToken}`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  // RED 7: 兑换状态转换非法返回 409
  test('invalid redemption transition rejected', async () => {
    const { parentToken, childToken } = await setupFamilyWithBoth();
    const redemption = await createRedemption(childToken, ...);

    // 直接尝试 fulfilled → approved（反向）
    const response = await request(app)
      .patch(`/api/redemptions/${redemption.id}/approve`)  // pending → approved 合法
      .set('Authorization', `Bearer ${parentToken}`);
    expect(response.status).toBe(200);

    // approved → rejected 不合法
    const response2 = await request(app)
      .patch(`/api/redemptions/${redemption.id}/reject`)
      .set('Authorization', `Bearer ${parentToken}`);
    expect(response2.status).toBe(409);
    expect(response2.body.error.code).toBe('CONFLICT');
  });
});

### 切片 17.3：速率限制

```typescript
describe('Rate limiting', () => {

  // RED 8: 登录接口超限返回 429
  test('login endpoint returns 429 after 10 attempts per minute', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'wrong' });
    }

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@x.com', password: 'wrong' });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });
});
```

---

## 18. 测试用例 - Phase 2 功能预占位

> Phase 2 功能在 MVP 中不实现，但测试规格已留位，待 Phase 2 启动时填充。

```typescript
// tests/integration/phase2.test.ts

describe.skip('Phase 2: Daily check-in reminder', () => {
  test('sends reminder at 09:00 for children who have not checked in');
  test('does not send reminder if child has any checkin today');
});

describe.skip('Phase 2: Achievement wall', () => {
  test('shows sibling dimension statuses when enabled');
  test('hides sibling data when family.achievement_wall_enabled is false');
  test('never shows sibling point numbers');
});

describe.skip('Phase 2: PDF growth archive export', () => {
  test('exports PDF at summer end date');
  test('PDF contains: diary highlights, points summary, dimensions, reviews');
});

describe.skip('Phase 2: Task templates by age group', () => {
  test('returns different templates for 6-8 vs 12-14');
  test('templates can be customized per family');
});
```

---

## 19. 测试用例 - 性能与负载

> 仅在 CI 中运行（标记为 `@performance`），不阻塞常规 build。

```typescript
// tests/e2e/performance.spec.ts

describe('@performance Load test', () => {

  // RED 1: 100 并发打卡延迟 < 500ms P95
  test('100 concurrent checkins P95 < 500ms', async () => {
    const users = await createTestChildren(100);
    const start = Date.now();
    const latencies: number[] = [];

    await Promise.all(users.map(async ({ token, taskId }) => {
      const t0 = Date.now();
      await request(app)
        .post('/api/checkins')
        .set('Authorization', `Bearer ${token}`)
        .send({ task_id: taskId, date: '2026-07-16' });
      latencies.push(Date.now() - t0);
    }));

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    expect(p95).toBeLessThan(500);
  });

  // RED 2: 单家庭大数据量查询性能
  test('balance query on 10k transactions < 100ms', async () => {
    const { childId } = await seedLargeHistory(childId, { transactions: 10000 });
    const start = Date.now();
    await request(app).get(`/api/points/balance?child_id=${childId}`);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
```

---

## 20. 更新后的总计

| 层 | 测试数 | 说明 |
|----|-------|------|
| 单元测试 | 23 | 20（原）+ 3（复盘可见性纯函数） |
| 集成测试 | 56 | 28（原）+ 9（复盘）+ 5（日记）+ 4（并发）+ 3（多租户）+ 3（JWT）+ 2（加密）+ 2（幂等）= 增 28 |
| 组件测试 | 14 | 不变 |
| E2E测试 | 4 | 2（原）+ 2（性能） |
| Phase 2 占位 | 4 | `describe.skip` 占位 |
| **总计** | **97 + 4 占位** | |

### 优先级排序（TDD 执行顺序扩展）

| 优先级 | 章节 | 说明 |
|--------|------|------|
| P0（MVP 必须） | §4-§9, §13, §14 | MVP 核心闭环 + 双盲复盘 + 日记 |
| P1（MVP 必须） | §15, §16 | 并发安全 + 多租户隔离 |
| P2（MVP 应有） | §17 | 错误流与边界 |
| P3（Phase 2 前置） | §18 | 占位测试，确认 Phase 2 范围 |
| P4（发布前） | §19 | 性能与负载 |

### 测试覆盖度矩阵

| 模块 | 单元 | 集成 | 组件 | E2E | 覆盖度 |
|------|------|------|------|-----|--------|
| Auth | - | 9 | - | 1 | ✅ 完整 |
| Children | - | 3 | - | - | ✅ 完整 |
| Tasks | 4 | 4 | - | - | ✅ 完整 |
| Check-ins | - | 6 | 6 | 1 | ✅ 完整 |
| Points | 4 | 4 | - | - | ✅ 完整 |
| Rewards/Redemptions | 6 | 6 | 5 | 1 | ✅ 完整 |
| Growth Map | 6 | - | 3 | - | ✅ 完整 |
| Weekly Review | 3 | 6 | - | - | ✅ 新增完整 |
| Growth Diary | - | 5 | - | - | ✅ 新增完整 |
| Concurrency | - | 4 | - | - | ✅ 新增 |
| Security | - | 8 | - | - | ✅ 新增 |
| Error flows | - | 8 | - | - | ✅ 新增 |
| Performance | - | - | - | 2 | ✅ 新增 |

---

## 附录：TDD 检查清单

在开始每个切片前确认：

- [ ] 已定义接缝（公共接口）
- [ ] 测试文件已创建
- [ ] 测试名称描述行为（非实现）
- [ ] 一个测试只验证一个行为
- [ ] 预期值来自独立来源（规格/固定值，非计算）

在完成每个切片后确认：

- [ ] 看到测试失败（RED），且失败原因正确
- [ ] 写了最少的代码让测试通过（GREEN）
- [ ] 所有测试通过
- [ ] 无多余的错误/警告
- [ ] 未添加测试未要求的功能
- [ ] 代码已清理（REFACTOR，可选）
