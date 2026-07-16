# 暑假成长积分银行 - 原型测试报告

> **报告日期**：2026-07-17
> **被测对象**：[index.html](../index.html) 单文件原型
> **测试基线**：commit `3f09250` 之后的版本（已加 data-* 测试钩子）

---

## 1. 测试总览

| 测试层 | 工具 | 用例数 | 通过 | 失败 | 时长 |
|--------|------|--------|------|------|------|
| 业务逻辑层 | Node.js vm sandbox | 59 | 59 | 0 | <1s |
| UI 端到端 | Playwright (chromium) | 12 | 12 | 0 | 6.2s |
| **合计** | — | **71** | **71** | **0** | **~7s** |

**结论**：✅ 全部通过。原型可交付。

---

## 2. 测试方法论

### 2.1 业务逻辑层（scratch/test_logic.js）

**方法**：用 Node.js 内置 `vm` 模块创建沙箱，mock `localStorage`/`document`/`window`，把 `index.html` 中的 `<script>` 块原封不动地放进沙箱执行，然后调用 `checkin`/`createRedemption`/`approveRedemption`/`fulfillRedemption`/`addTask`/`deleteTask`/`addReward`/`deleteReward`/`getBalance`/`getDimensionProgress`/`resetData` 等函数，断言返回值与状态变化。

**优势**：
- 不依赖浏览器，CI 友好
- 能精确断言每个函数的返回值和 state 内部结构
- 比 browser automation 快 10×以上

**关键技术细节**：
- `let state = loadState();` 是顶层 `let` 绑定，vm context 中不会挂到 `globalThis`。用 `Object.defineProperty(globalThis, 'state', { get() { return state; }, set(v) { state = v; } })` 暴露。
- Canvas `getContext()` 返回的 ctx mock 需要包含 `fillText`/`arc`/`beginPath` 等方法，否则初始 `renderApp()` 调用 `drawRadar` 时会抛 `ctx.fillText is not a function`。

**日志**：`scratch/test_logic.log`

### 2.2 UI 端到端层（tests/prototype.spec.js）

**方法**：Playwright 启动 headless chromium，加载 `file://` 协议的 `index.html`，模拟用户操作（切换角色 / 切换 tab / 点击打卡 / 填表单 / 兑换 / 审核 / 刷新），通过 `page.evaluate(() => getBalance('c1'))` 等方式断言应用状态。

**测试钩子**：在 `index.html` 关键元素上加 `data-*` 属性作为稳定选择器，避免依赖易变的 class 或文本：

| 数据属性 | 元素 | 用途 |
|---------|------|------|
| `data-role-switch` | `<select id="roleSwitch">` | 切换家长/孩子角色 |
| `data-tab="checkin"` | 底部 tab 按钮 | 切换主视图 |
| `data-task-checkin="t1"` | 任务打卡卡片 | 孩子打卡 |
| `data-redeem="r3"` | 奖励兑换按钮 | 孩子发起兑换 |
| `data-approve-redemption="..."` | 家长审核通过按钮 | 兑换状态机 |
| `data-fulfill-redemption="..."` | 家长标记已兑现按钮 | 兑换状态机 |
| `data-new-task` | 新建任务按钮 | 家长任务管理 |
| `data-delete-task="t1"` | 删除任务按钮 | 家长任务管理 |
| `data-new-reward` | 新建奖励按钮 | 家长奖励管理 |
| `data-delete-reward="r1"` | 删除奖励按钮 | 家长奖励管理 |

**配置**：`playwright.config.js` — headless chromium，480×800 移动端视口，串行执行（workers=1），HTML+JSON 报告输出到 `scratch/`。

---

## 3. 测试用例覆盖映射

PROTOTYPE_TDD.md 中定义了 14 个手动测试场景（T01-T14）。覆盖情况：

| TDD 用例 | 描述 | 逻辑层 | UI 层 | 状态 |
|---------|------|--------|-------|------|
| T01 | 孩子打卡一个任务 | T02 | ✓ T01 | ✅ |
| T02 | 同天重复打卡同任务 | T03 | ✓ T02 | ✅ |
| T03 | 完成某维度全部任务 | T12 | ✓ T03 | ✅ |
| T04 | 跨日打卡 | — | — | ⏭️ 手动（需改系统日期） |
| T05 | 余额计算正确 | T02+T04 | ✓ T05 | ✅ |
| T06 | 兑换后余额扣减 | T07 | ✓ T06 | ✅ |
| T07 | 余额不足按钮置灰 | T06 | ✓ T07 | ✅ |
| T08 | 孩子发起兑换 | T07 | ✓ T08 | ✅ |
| T09 | 家长通过兑换 | T08 | ✓ T09 | ✅ |
| T10 | 家长标记已兑现 | T10 | ✓ T10 | ✅ |
| T11 | 家长新增任务 | T13 | ✓ T11 | ✅ |
| T12 | 家长删除任务 | T13 | ✓ T12 | ✅ |
| T13 | 家长新增奖励 | T14 | ✓ T13 | ✅ |
| T14 | 刷新不丢数据 | T15 | ✓ T14 | ✅ |

**额外覆盖**（不在 TDD 中但已测）：
- 重复 approve/fulfill 状态守卫（逻辑层 T09/T11）
- inactive 任务拦截（逻辑层 T05）
- resetData 完全清除（逻辑层 T16）
- 种子数据完整性（逻辑层 T01 + UI T15）

**未覆盖**：
- T04 跨日打卡（需修改系统日期，不适合自动化）
- UI 雷达图渲染像素验证（Canvas 画了什么无法用 Playwright 断言，但 `drawRadar` 在逻辑层执行无异常）

---

## 4. 详细测试结果

### 4.1 业务逻辑层（59/59 通过）

```
[T01] seed data                        7/7
[T02] checkin first task                6/6
[T03] duplicate checkin blocked         3/3
[T04] second task checkin               2/2
[T05] inactive task blocked             2/2
[T06] insufficient balance redemption   3/3
[T07] successful redemption             7/7
[T08] approve redemption                3/3
[T09] re-approve rejected               1/1
[T10] fulfill redemption                3/3
[T11] re-fulfill rejected               1/1
[T12] dimension progress                6/6
[T13] task management                   4/4
[T14] reward management                 4/4
[T15] persistence                       3/3
[T16] resetData                         4/4
                                     -------
                                       59/59
```

### 4.2 UI 端到端层（12/12 通过，6.2s）

```
✓ T01: child checks in one task → +10 points                    (1.6s)
✓ T02: duplicate checkin same day → blocked                     (230ms)
✓ T03: d1 (3 tasks) → 100% after t1+t2+t3                       (260ms)
✓ T05: 3 tasks → 10+10+20 = 40                                  (337ms)
✓ T07: insufficient balance → button disabled                   (168ms)
✓ T06: redeem r3 (30pts) with 40 balance → -30                  (393ms)
✓ T08+T09+T10: pending → approved → fulfilled                   (546ms)
✓ T11: create task → visible to child                           (343ms)
✓ T12: delete task → removed but history preserved              (279ms)
✓ T13: create reward → visible to child                         (229ms)
✓ T14: reload preserves all state                               (239ms)
✓ T15: seed has 5/15/6/1                                        (90ms)
```

**报告产物**：
- HTML 报告：`scratch/playwright-report/index.html`（gitignored）
- JSON 结果：`scratch/playwright-results.json`（gitignored）
- 文本日志：上述控制台输出

---

## 5. 复现步骤

### 5.1 运行业务逻辑测试

```bash
node scratch/test_logic.js
# 期望输出最后两行：
# === RESULT: 59 passed, 0 failed ===
```

### 5.2 运行 Playwright UI 测试

```bash
# 首次需要安装（自动）：
npm install
npx playwright install chromium

# 运行：
npm test
# 或：npx playwright test

# 查看详细 HTML 报告：
npx playwright show-report scratch/playwright-report
```

### 5.3 一键全套

```bash
npm run logic && npm test
```

---

## 6. 测试发现的问题与修复

### 6.1 加 data-* 测试钩子

**问题**：原 `index.html` 用 class 和内联 onclick，没有稳定的测试选择器。Playwright TDD 文档中提到的 `[data-task-checkin="t1"]` 等选择器不存在。

**修复**：在 10 处关键元素加 `data-*` 属性（详见 §2.2 表）。**不改变任何业务逻辑**，纯加钩子。

### 6.2 onclick 点击区域

**问题**：早期版本（已在前一 session 修复）打卡点击区域是 24×24px 的小圆点，browser_use 自动化点击精度不够。

**修复**：onclick 已绑在整个 `.task-item` div 上（不止小圆点）。Playwright `page.click('[data-task-checkin="t1"]')` 直接命中整个卡片，无精度问题。

### 6.3 未发现问题

逻辑层 59 用例和 UI 层 12 用例均无失败，无需修复的业务 bug。

---

## 7. 已知限制

1. **T04 跨日打卡未自动化**：需修改系统时钟，不在自动化范围内。建议人工验证。
2. **Canvas 雷达图未像素级验证**：Playwright 不能断言 Canvas 画了什么。已通过逻辑层 `drawRadar` 函数执行无异常 + 视觉检查确认。
3. **测试在 headless 模式跑**：如果需要看 UI 动画效果，运行 `npm run test:headed`。
4. **localStorage 隔离**：每个 Playwright 测试用 `beforeEach` 调 `resetData()` 重置。如果手动在浏览器中操作过，需要打开 DevTools 执行 `localStorage.clear()` 后刷新。

---

## 8. 验收结论

| 验收项 | 要求 | 实际 | 状态 |
|--------|------|------|------|
| 核心闭环可运行 | 打卡→赚积分→兑换→审核→兑现 | T01→T05→T08→T09→T10 全通 | ✅ |
| 业务规则正确 | 唯一约束 / 余额推导 / 状态机 / 维度点亮 | 59 逻辑断言全通 | ✅ |
| 持久化 | 刷新不丢数据 | T14 通过 | ✅ |
| 管理功能 | 任务/奖励 CRUD | T11/T12/T13 通过 | ✅ |
| 零依赖 | 双击即跑 | `index.html` 单文件，无 import/require | ✅ |
| 测试自动化 | 至少核心闭环 5 场景 | 12 UI + 59 逻辑 = 71 用例 | ✅ |

**最终结论**：原型通过全部验收标准，可作为 PRD 核心闭环的可用验证。

---

## 相关文档

- [PROTOTYPE_SPEC.md](./PROTOTYPE_SPEC.md) — 原型规格说明
- [PROTOTYPE_TDD.md](./PROTOTYPE_TDD.md) — 测试场景定义
- [PRD.md](./PRD.md) — 产品需求文档
