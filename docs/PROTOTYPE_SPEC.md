# 暑假成长积分银行 - 原型规格说明（PROTOTYPE_SPEC）

> **文档版本**：v1.0
> **创建日期**：2026-07-16
> **载体**：单文件 `index.html`（vanilla JS，零依赖，双击即跑）
> **基于**：[PRD.md](./PRD.md) 核心闭环 4 功能

---

## 1. 设计目标

用最轻量的技术验证 PRD 核心闭环：**打卡 → 赚积分 → 兑换奖励**。

| 目标 | 说明 |
|------|------|
| 真实逻辑 | 所有业务计算真实实现，非 mockup |
| 零依赖 | 单文件 HTML，双击浏览器即跑，无需安装/构建 |
| 数据持久 | localStorage 存储，刷新不丢 |
| 核心闭环 | 成长地图 + 今日打卡 + 积分系统 + 奖励兑换 |

### 明确不做

- 用户认证（无登录/注册，顶部切换角色）
- 多家庭/多租户（单家庭模式）
- 多孩子（预设 1 个孩子）
- 每周复盘（第二期）
- 成长日记（第二期）
- 打卡撤销（简化）
- 年龄分组（简化）
- 数据导出/PDF

---

## 2. 数据结构

localStorage 单 key `gpb_data`，存储以下 JSON：

```json
{
  "version": 1,
  "currentRole": "child",
  "dimensions": [...],
  "tasks": [...],
  "rewards": [...],
  "children": [...],
  "checkins": [...],
  "pointTransactions": [...],
  "redemptions": [...]
}
```

### 2.1 Dimension（成长维度）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键（"d1"~"d5"） |
| name | string | 维度名称 |
| icon | string | emoji 图标 |
| color | string | 主题色（十六进制） |
| sortOrder | number | 排序 |

### 2.2 Task（任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键（"t1", "t2"...） |
| dimensionId | string | 关联维度 |
| title | string | 任务名称 |
| pointValue | number | 积分值（固定） |
| isActive | boolean | 是否启用 |

### 2.3 CheckIn（打卡记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| childId | string | 关联孩子 |
| taskId | string | 关联任务 |
| date | string | 打卡日期（YYYY-MM-DD） |
| createdAt | string | 打卡时间（ISO） |

> 约束：UNIQUE(childId, taskId, date) — 同一天同一任务只能打卡一次

### 2.4 PointTransaction（积分流水）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| childId | string | 关联孩子 |
| amount | number | 变动值（正数获得/负数消耗） |
| sourceType | string | "task" 或 "redemption" |
| sourceId | string | 任务ID 或 兑换ID |
| createdAt | string | 创建时间（ISO） |

> 余额 = SUM(amount) WHERE childId = X。不存 balance 列。

### 2.5 Reward（奖励）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键（"r1"...） |
| tier | string | 档位："small"/"medium"/"large" |
| pointCost | number | 所需积分 |
| title | string | 奖励标题 |
| description | string | 奖励描述 |
| isActive | boolean | 是否启用 |

### 2.6 Redemption（兑换记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| childId | string | 关联孩子 |
| rewardId | string | 关联奖励 |
| pointCost | number | 消耗积分（快照） |
| childNote | string | 孩子说明 |
| status | string | "pending"/"approved"/"fulfilled" |
| parentNote | string | 家长备注 |
| createdAt | string | 申请时间 |
| reviewedAt | string | 审核时间 |
| fulfilledAt | string | 兑现时间 |

### 2.7 Child（孩子）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键（"c1"） |
| name | string | 姓名 |
| avatar | string | emoji 头像 |

---

## 3. 种子数据

首次加载时自动注入（若 localStorage 无数据）：

### 3.1 维度（5 个）

| id | name | icon | color |
|----|------|------|-------|
| d1 | 学习力 | 📚 | #2196F3 |
| d2 | 运动力 | ⚽ | #FF9800 |
| d3 | 自控力 | 🎯 | #9C27B0 |
| d4 | 探索力 | 🔍 | #4CAF50 |
| d5 | 实践力 | 🤲 | #F44336 |

### 3.2 任务（15 个，每维度 3 个）

| id | dimensionId | title | pointValue |
|----|-------------|-------|------------|
| t1 | d1 | 阅读30分钟 | 10 |
| t2 | d1 | 练字一页 | 10 |
| t3 | d1 | 写日记 | 20 |
| t4 | d2 | 户外活动1小时 | 20 |
| t5 | d2 | 跳绳100下 | 10 |
| t6 | d2 | 跑步15分钟 | 20 |
| t7 | d3 | 按时起床 | 10 |
| t8 | d3 | 屏幕时间<1小时 | 20 |
| t9 | d3 | 自主安排时间表 | 30 |
| t10 | d4 | 尝试一件新事物 | 30 |
| t11 | d4 | 情绪日记 | 20 |
| t12 | d4 | 主动与人沟通 | 10 |
| t13 | d5 | 洗碗 | 10 |
| t14 | d5 | 做一道菜 | 30 |
| t15 | d5 | 整理房间 | 20 |

### 3.3 奖励（6 个，每档 2 个）

| id | tier | pointCost | title | description |
|----|------|-----------|-------|-------------|
| r1 | small | 10 | 选一次家庭电影 | 全家一起看一部你选的电影 |
| r2 | small | 10 | 点播睡前故事 | 爸妈为你讲一个故事 |
| r3 | medium | 30 | 买一本喜欢的书 | 去书店选一本书 |
| r4 | medium | 30 | 一次朋友聚会 | 邀请好朋友来家里玩 |
| r5 | large | 60 | 一次短途旅行 | 全家去一个你想去的地方 |
| r6 | large | 60 | 实现一个小愿望 | 说一个你期待的小愿望 |

### 3.4 孩子（1 个）

| id | name | avatar |
|----|------|--------|
| c1 | 小明 | 🧒 |

---

## 4. 视图清单

### 4.1 布局

```
┌─────────────────────────────────┐
│  [角色切换器: 家长▼ / 孩子▼]    │  ← 顶部固定
├─────────────────────────────────┤
│                                 │
│         视图内容区              │  ← JS 切换
│                                 │
├─────────────────────────────────┤
│ [tab1][tab2][tab3][tab4]        │  ← 底部导航
└─────────────────────────────────┘
```

### 4.2 家长 4 视图

| # | 视图 | 功能 |
|---|------|------|
| P1 | 成长地图 | 查看孩子进度：雷达图 + 5维度卡片 + 今日完成率 |
| P2 | 任务管理 | 增删改任务：列表 + 新建表单（标题/维度/积分值） |
| P3 | 奖励管理 | 增删改奖励：列表 + 新建表单（标题/档位/积分/描述） |
| P4 | 兑换审核 | 处理 pending 兑换：列表 + 通过/标记已兑现按钮 |

### 4.3 孩子 4 视图

| # | 视图 | 功能 |
|---|------|------|
| C1 | 成长地图 | 自己的进度：雷达图 + 5维度卡片 + 今日完成率 |
| C2 | 今日打卡 | 任务列表（按维度筛选）+ 勾选打卡 + 实时积分 |
| C3 | 积分记录 | 余额 + 流水列表（时间倒序） |
| C4 | 奖励兑换 | 余额 + 三档奖励列表 + 发起兑换（积分不足置灰） |

---

## 5. 业务规则

### 5.1 打卡规则

- **唯一约束**：同一天同一任务只能打卡一次
- **积分发放**：打卡成功时立即发放 `task.pointValue` 积分
- **不可撤销**：原型不实现撤销功能
- **每日重置**：打卡状态按日期判断，新的一天可重新打卡

### 5.2 积分规则

- **余额计算**：`balance = SUM(pointTransactions.amount) WHERE childId = c1`
- **正向**：打卡 → +pointValue（sourceType="task"）
- **负向**：兑换发起 → -pointCost（sourceType="redemption"）
- **不可退**：因不实现 rejected，积分扣后不可退

### 5.3 兑换规则

- **积分检查**：发起兑换前检查余额 ≥ pointCost，不足则置灰
- **扣除时机**：发起兑换时立即扣除积分
- **状态机**：
  ```
  pending → approved → fulfilled
  ```
  - `pending`：孩子发起，等待家长审核
  - `approved`：家长通过，等待兑现
  - `fulfilled`：家长标记已兑现
- **不可拒绝**：原型不实现 rejected/cancelled

### 5.4 维度点亮规则

- **今日完成数**：`count(checkins WHERE taskId IN tasks WHERE dimensionId = X AND date = TODAY)`
- **今日总数**：`count(tasks WHERE dimensionId = X AND isActive = true)`
- **点亮条件**：完成数 == 总数（且总数 > 0）
- **进度百分比**：完成数 / 总数 × 100

### 5.5 雷达图数据

五维度完成率（今日）：
```
data = dimensions.map(d => ({
  label: d.name,
  value: todayCompletedCount(d.id) / totalTaskCount(d.id) * 100
}))
```

---

## 6. 技术实现

### 6.1 文件结构

```
index.html  （单文件，包含 HTML + CSS + JS）
```

### 6.2 JS 架构

```
┌──────────────────────────────────────┐
│           State (localStorage)       │
│  gpb_data = { dimensions, tasks,     │
│    checkins, pointTransactions,      │
│    rewards, redemptions, children }  │
├──────────────────────────────────────┤
│           Store API                  │
│  loadState() / saveState()           │
│  resetState() / seedState()          │
├──────────────────────────────────────┤
│           Business Logic             │
│  checkin(childId, taskId)            │
│  getBalance(childId)                 │
│  createRedemption(childId, rewardId) │
│  approveRedemption(id)               │
│  fulfillRedemption(id)               │
│  getDimensionProgress(dimId, date)   │
├──────────────────────────────────────┤
│           View Renderers             │
│  renderParentMap()                   │
│  renderParentTasks()                 │
│  renderParentRewards()               │
│  renderParentRedemptions()           │
│  renderChildMap()                    │
│  renderChildCheckin()                │
│  renderChildPoints()                 │
│  renderChildRewards()                │
├──────────────────────────────────────┤
│           Canvas Radar Chart         │
│  drawRadar(canvas, data)             │
└──────────────────────────────────────┘
```

### 6.3 雷达图规格

- **Canvas 尺寸**：240×240px（自适应容器）
- **五边形**：5 个顶点对应 5 维度
- **刻度**：0-100%，每 20% 一圈
- **填充**：完成率区域半透明填充
- **标签**：每个顶点显示维度名 + 完成率%
- **配色**：填充色 #FFC107（半透明），描边 #FF9800

---

## 7. 验证清单

### 7.1 核心闭环验证

| # | 场景 | 预期 |
|---|------|------|
| 1 | 孩子打卡一个任务 | 积分增加，打卡记录创建 |
| 2 | 孩子同天重复打卡同任务 | 拒绝（提示已打卡） |
| 3 | 孩子完成某维度全部任务 | 维度点亮，雷达图该维度 100% |
| 4 | 孩子余额不足时发起兑换 | 按钮置灰，显示"差 X 分" |
| 5 | 孩子余额充足发起兑换 | 积分扣除，兑换记录创建（pending） |
| 6 | 家长通过兑换 | 状态 → approved |
| 7 | 家长标记已兑现 | 状态 → fulfilled |
| 8 | 家长新增任务 | 任务列表更新 |
| 9 | 家长删除任务 | 任务列表更新（已有打卡记录保留） |
| 10 | 刷新页面 | 数据不丢失 |

### 7.2 数据一致性验证

| # | 场景 | 预期 |
|---|------|------|
| 11 | 打卡后查余额 | = 流水累加 |
| 12 | 兑换后查余额 | = 原余额 - pointCost |
| 13 | 多次打卡+兑换后查流水 | 时间倒序，金额正确 |

---

## 8. 限制说明

1. **积分不可退**：因不实现 rejected，孩子发起兑换后积分立即扣除且不可恢复。家长只能"通过"或"不管"。
2. **单孩子**：预设 1 个孩子，不支持多孩子。
3. **无认证**：任何人打开 HTML 都能切换角色操作。
4. **数据本地**：localStorage 仅存浏览器，清浏览器数据会丢失。
5. **无后台任务**：不实现 cron 提醒/通知。

---

## 相关文档

- [PRD.md](./PRD.md) — 产品需求文档（完整功能定义）
- [PROTOTYPE_TDD.md](./PROTOTYPE_TDD.md) — 原型测试场景
