# 暑假成长积分银行 - 原型测试场景（PROTOTYPE_TDD）

> **文档版本**：v1.0
> **创建日期**：2026-07-16
> **基于**：[PROTOTYPE_SPEC.md](./PROTOTYPE_SPEC.md)

---

## 1. 测试策略

原型为单文件 HTML，测试以**手动验证**为主，辅以**可选 Playwright 自动化**。

| 类型 | 工具 | 范围 |
|------|------|------|
| 手动测试 | 浏览器 + DevTools Console | 全部 13 个场景 |
| 自动化测试（可选） | Playwright | 核心闭环 5 个场景 |

### 1.1 手动测试方法

1. 双击 `index.html` 在浏览器打开
2. 按 F12 打开 DevTools
3. Console 中可执行 `getData()` 查看当前数据
4. Console 中可执行 `resetData()` 重置种子数据
5. 按场景表逐步操作，验证预期结果

### 1.2 Console 辅助 API

原型暴露以下全局函数供测试：

```js
getData()           // 查看完整 localStorage 数据
resetData()         // 重置为种子数据
getBalance('c1')    // 查询孩子余额
getDimensionProgress('d1', '2026-07-16')  // 查询维度今日进度
```

---

## 2. 测试场景

### 2.1 打卡模块（4 场景）

#### T01: 孩子打卡一个任务

**前置**：切换到孩子角色，今日打卡视图
**步骤**：
1. 在今日打卡视图找到"阅读30分钟"（d1，10分）
2. 点击勾选

**预期**：
- [ ] 勾选状态变为已完成
- [ ] 积分余额 +10
- [ ] 成长地图 d1 维度进度更新
- [ ] localStorage 中 checkins 新增一条记录
- [ ] localStorage 中 pointTransactions 新增 +10 记录

#### T02: 同天重复打卡同任务

**前置**：T01 已完成
**步骤**：
1. 再次点击"阅读30分钟"的勾选

**预期**：
- [ ] 提示"今日已打卡"
- [ ] 不产生新记录
- [ ] 余额不变

#### T03: 完成某维度全部任务

**前置**：切换到孩子角色
**步骤**：
1. 打卡 d1 的全部 3 个任务（阅读30分钟/练字一页/写日记）

**预期**：
- [ ] d1 维度卡片显示"已点亮"
- [ ] 雷达图 d1 顶点到达 100%
- [ ] d1 卡片变金色

#### T04: 跨日打卡

**前置**：今日已打卡若干任务
**步骤**：
1. 在 Console 执行 `getData()` 确认今日打卡
2. 修改系统日期到明天
3. 刷新页面

**预期**：
- [ ] 昨日打卡不再显示为"已完成"
- [ ] 可重新打卡所有任务
- [ ] 历史积分仍保留

---

### 2.2 积分模块（3 场景）

#### T05: 余额计算正确

**前置**：已打卡 3 个任务（10+10+20=40分）
**步骤**：
1. 切换到孩子角色 → 积分记录视图

**预期**：
- [ ] 余额显示 40
- [ ] 流水列表 3 条记录，金额分别为 +10/+10/+20
- [ ] 流水按时间倒序排列

#### T06: 兑换后余额扣减

**前置**：余额 40
**步骤**：
1. 发起兑换"买一本喜欢的书"（r3，30分）
2. 查看余额

**预期**：
- [ ] 余额变为 10（40-30）
- [ ] 流水新增 -30 记录
- [ ] 兑换记录状态为 pending

#### T07: 余额不足时兑换按钮置灰

**前置**：余额 10
**步骤**：
1. 切换到孩子角色 → 奖励兑换视图
2. 查看"一次短途旅行"（r5，60分）

**预期**：
- [ ] 兑换按钮置灰/禁用
- [ ] 显示"差 50 分"

---

### 2.3 兑换模块（3 场景）

#### T08: 孩子发起兑换

**前置**：余额 ≥ 30
**步骤**：
1. 孩子角色 → 奖励兑换视图
2. 点击"买一本喜欢的书"（r3，30分）的兑换按钮
3. 填写说明"我坚持阅读了一周"
4. 确认兑换

**预期**：
- [ ] 余额扣减 30
- [ ] 兑换记录创建，status=pending
- [ ] 兑换审核视图（家长端）出现该记录

#### T09: 家长通过兑换

**前置**：T08 已完成
**步骤**：
1. 切换到家长角色 → 兑换审核视图
2. 找到 pending 记录
3. 点击"通过"

**预期**：
- [ ] 状态变为 approved
- [ ] 记录移到"已通过"区域

#### T10: 家长标记已兑现

**前置**：T09 已完成
**步骤**：
1. 家长角色 → 兑换审核视图
2. 找到 approved 记录
3. 点击"标记已兑现"

**预期**：
- [ ] 状态变为 fulfilled
- [ ] 记录移到"已兑现"区域

---

### 2.4 管理模块（3 场景）

#### T11: 家长新增任务

**前置**：家长角色
**步骤**：
1. 任务管理视图 → 点击"新建任务"
2. 填写：标题"背10个单词"，维度"学习力"，积分值 15
3. 保存

**预期**：
- [ ] 任务列表出现新任务
- [ ] 切换到孩子角色，今日打卡可见该任务
- [ ] 打卡该任务获得 15 分

#### T12: 家长删除任务

**前置**：已有任务"背10个单词"
**步骤**：
1. 任务管理视图 → 找到该任务
2. 点击删除

**预期**：
- [ ] 任务从列表移除
- [ ] 孩子端今日打卡不再显示该任务
- [ ] 已有的打卡记录和积分流水保留

#### T13: 家长新增奖励

**前置**：家长角色
**步骤**：
1. 奖励管理视图 → 点击"新建奖励"
2. 填写：标题"去游乐园"，档位"large"，积分 60，描述"全家去游乐园玩一天"
3. 保存

**预期**：
- [ ] 奖励列表出现新奖励
- [ ] 切换到孩子角色，奖励兑换视图可见该奖励

---

### 2.5 持久化（1 场景）

#### T14: 刷新不丢数据

**前置**：已执行若干打卡和兑换
**步骤**：
1. 记录当前余额和打卡数
2. 按 F5 刷新页面

**预期**：
- [ ] 余额不变
- [ ] 打卡记录保留
- [ ] 兑换记录保留
- [ ] 当前角色保持

---

## 3. 可选：Playwright 自动化测试

### 3.1 环境准备

```bash
npm init -y
npm install -D @playwright/test
npx playwright install chromium
```

### 3.2 核心闭环测试脚本（5 场景）

```js
// tests/prototype.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_PATH = `file://${path.resolve(__dirname, '../index.html')}`;

test.beforeEach(async ({ page }) => {
  await page.goto(HTML_PATH);
  await page.evaluate(() => resetData());
});

test('T01: 孩子打卡一个任务', async ({ page }) => {
  // 切换到孩子角色
  await page.selectOption('[data-role-switch]', 'child');
  // 切换到今日打卡 tab
  await page.click('[data-tab="checkin"]');
  // 打卡第一个任务
  await page.click('[data-task-checkin="t1"]');
  // 验证积分
  const balance = await page.evaluate(() => getBalance('c1'));
  expect(balance).toBe(10);
});

test('T05: 余额计算正确', async ({ page }) => {
  await page.selectOption('[data-role-switch]', 'child');
  await page.click('[data-tab="checkin"]');
  await page.click('[data-task-checkin="t1"]');
  await page.click('[data-task-checkin="t2"]');
  await page.click('[data-task-checkin="t3"]');
  const balance = await page.evaluate(() => getBalance('c1'));
  expect(balance).toBe(40); // 10+10+20
});

test('T08: 孩子发起兑换', async ({ page }) => {
  // 先赚够积分
  await page.selectOption('[data-role-switch]', 'child');
  await page.click('[data-tab="checkin"]');
  await page.click('[data-task-checkin="t1"]'); // +10
  await page.click('[data-task-checkin="t2"]'); // +10
  await page.click('[data-task-checkin="t3"]'); // +20 = 40
  // 发起兑换
  await page.click('[data-tab="rewards"]');
  await page.click('[data-redeem="r3"]'); // 30分
  const balance = await page.evaluate(() => getBalance('c1'));
  expect(balance).toBe(10); // 40-30
});

test('T09: 家长通过兑换', async ({ page }) => {
  // ... (先完成 T08 步骤)
  await page.selectOption('[data-role-switch]', 'parent');
  await page.click('[data-tab="redemptions"]');
  await page.click('[data-approve-redemption]');
  // 验证状态
  const data = await page.evaluate(() => getData());
  expect(data.redemptions[0].status).toBe('approved');
});

test('T14: 刷新不丢数据', async ({ page }) => {
  await page.selectOption('[data-role-switch]', 'child');
  await page.click('[data-tab="checkin"]');
  await page.click('[data-task-checkin="t1"]');
  await page.reload();
  const balance = await page.evaluate(() => getBalance('c1'));
  expect(balance).toBe(10);
});
```

### 3.3 运行

```bash
npx playwright test
```

---

## 4. 验收标准

原型需通过全部 14 个手动测试场景。核心闭环（T01/T05/T08/T09/T10）为必须通过项。

---

## 相关文档

- [PROTOTYPE_SPEC.md](./PROTOTYPE_SPEC.md) — 原型规格说明
- [PRD.md](./PRD.md) — 产品需求文档
