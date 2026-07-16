# Summer Growth Points Bank / 暑假成长积分银行

A lightweight HTML prototype of a family "growth points bank" — gamifying children's summer growth across 5 dimensions (learning, sports, self-control, exploration, practice) via a points currency.

**Single file. Zero dependencies. Double-click to run.**

## Quick Start

1. Download `index.html`
2. Double-click to open in any modern browser (Chrome, Firefox, Edge, Safari)
3. That's it. No install, no build, no server required.

Data persists in browser `localStorage`. To reset, click the 🔄 button in the top-right of the map view, or run `resetData()` in the browser console.

## Features

| Role | View | What you can do |
|------|------|-----------------|
| Parent | Growth Map | View child's radar chart + 5-dimension progress |
| Parent | Task Management | Create / delete tasks (title, dimension, points) |
| Parent | Reward Management | Create / delete rewards (3 tiers) |
| Parent | Redemption Review | Approve pending redemptions, mark fulfilled |
| Child | Growth Map | View own radar chart + dimension progress |
| Child | Daily Check-in | Check off tasks by dimension filter, earn points |
| Child | Points Record | View balance + transaction history |
| Child | Reward Exchange | Browse rewards, spend points, submit redemption |

### Core Loop

```
Child checks in task → earns points → spends points on reward → parent approves → parent fulfills
```

### Business Rules

- Points deducted at redemption submission (not at approval)
- Redemption state machine: `pending → approved → fulfilled` (no reject/cancel)
- Same task can only be checked in once per day
- Dimension "lit" when all its tasks completed today
- Balance computed from transaction sum (no stored balance)

## Testing

### Manual Testing

Open `index.html`, press F12 for DevTools. Follow the 14 test scenarios in [docs/PROTOTYPE_TDD.md](docs/PROTOTYPE_TDD.md).

Console helpers:
```js
getData()                    // View all localStorage data
resetData()                  // Reset to seed data
getBalance('c1')             // Query child balance
getDimensionProgress('d1', '2026-07-16')  // Query dimension progress
```

### Optional: Playwright Automated Tests

```bash
npm init -y
npm install -D @playwright/test
npx playwright install chromium
npx playwright test
```

See [docs/PROTOTYPE_TDD.md](docs/PROTOTYPE_TDD.md) §3 for the test script.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/PRD.md](docs/PRD.md) | Product Requirements Document (full feature spec, Chinese) |
| [docs/PROTOTYPE_SPEC.md](docs/PROTOTYPE_SPEC.md) | Prototype specification (data structure, views, business rules) |
| [docs/PROTOTYPE_TDD.md](docs/PROTOTYPE_TDD.md) | Prototype test scenarios (14 manual + 5 Playwright) |

## Tech Stack

- **HTML/CSS/JS** — vanilla, zero dependencies
- **localStorage** — single-key JSON persistence
- **Canvas API** — radar chart rendering
- **No framework, no build tool, no package manager**

## Seed Data

On first load, the app auto-seeds:
- 5 growth dimensions (learning, sports, self-control, exploration, practice)
- 15 tasks (3 per dimension, 10-30 points each)
- 6 rewards (2 per tier: small/medium/large)
- 1 child ("小明")

## License

[MIT](LICENSE)

---

> 中文说明：本项目是一个家庭"暑假成长积分银行"原型，用最轻量的单文件 HTML 实现核心闭环（打卡→赚积分→兑换奖励）。双击 `index.html` 即可在浏览器中运行，无需安装任何依赖。详细文档见 `docs/` 目录。
