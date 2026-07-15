# Project Memory - 暑假成长积分银行

---

## 2026-07-15 23:26 - 项目初始化

### 需求来源
用户要求根据微信公众号文章《我，不懂代码，却给俩娃量身定制了一款"暑假成长积分银行"App》（作者：魔女库伊拉）整理一个产品PRD。

- **文章链接**: https://mp.weixin.qq.com/s/rgny628l633XrJeZokrcZg
- **文章获取方式**: 使用curl抓取HTML，通过PowerShell脚本提取og:title/og:description元数据和js_content区域内容

### 用户需求澄清结果
1. **目标平台**: Web应用（H5），非微信小程序
2. **PRD范围**: 原文+补充（以文章功能为基础，补充PRD必要要素）
3. **PRD用途**: 开发指导级别（需要详细的功能规格、数据模型、接口定义等）
4. **附加要求**: 调用/grill-me深度分析，然后调用/tdd编写TDD文档

### 产品概述
- **产品名称**: 暑假成长积分银行（Summer Growth Points Bank）
- **核心概念**: 将五大成长维度（学习力、运动力、自控力、探索力、实践力）通过积分银行机制游戏化
- **目标用户**: 家长（主用户）+ 孩子（端用户）
- **核心理念**: 将无形的"自律"转变为有形的"资产"，用代币经济催化内在驱动力

### 已完成工作
1. [x] 抓取并解析微信文章内容
2. [x] 头脑风暴流程：探索上下文 -> 澄清问题 -> 提出方案 -> 呈现设计
3. [x] 编写完整PRD文档（10大章节，722行）
4. [x] 规格自检（修复了每周任务重置规则的歧义）
5. [x] Git初始化并提交
6. [x] 调用/grill-me对PRD进行10轮深度拷问
7. [x] 根据grilling决策更新PRD（移除拍照/录像，改为纯文字成长日记等）
8. [x] 调用/tdd编写TDD测试规格文档（64个测试，4层测试金字塔）
9. [x] 保存project_memory.md

### Grilling决策汇总
1. 任务验证：信任+抽检（家长可撤销不实打卡）
2. 积分过期：永久保留，跨暑假累积
3. 兄弟姐妹可见性：默认不可见+家庭成就墙
4. 每周复盘：真正双盲机制
5. 惩罚机制：无惩罚，积分只增不减
6. 奖励履约：增加待履约→已兑现状态追踪
7. 年龄适配：任务模板按年龄段推荐
8. 离线冲突：最后写入+冲突告警
9. 数据导出：PDF成长档案+日记导出
10. MVP分期：分两期；移除拍照/录视频功能

### TDD文档位置
`E:\git\growth-points-bank\TDD_SPEC.md`

### TDD核心结构
- 20个单元测试（领域逻辑纯函数）
- 28个集成测试（API接口）
- 14个组件测试（前端React组件）
- 2个E2E测试（完整用户流程）
- 总计64个测试，按垂直切片组织

### 技术栈假设
- 前端: React 18 + TypeScript + Vitest + Testing Library
- 后端: Node.js + Express/Fastify + Vitest + supertest
- 数据库: PostgreSQL（生产）/ SQLite in-memory（测试）
- E2E: Playwright

### 临时文件
以下临时文件位于E:\git\根目录，用于文章内容提取：
- wechat_article_raw.html - 原始HTML
- extract_article.ps1 - 第一版提取脚本
- extract_content2.ps1 - 第二版提取脚本
- article_content.txt - 提取的文本内容
- article_extracted.txt - 第一版提取结果

---

## 2026-07-16 02:30 — 开发前置准备完成

### 本次工作目标
根据用户原始指令"请根据PRD完善TDD_SPEC，并做详细设计和架构图、API文档等开发前置准备动作"，完成开发前置文档套件：
- 10 个 ADR（架构决策记录）
- 主架构文档（ARCHITECTURE.md，含 C4 三层图）
- 详细设计文档（DETAILED_DESIGN.md，12 章节）
- API 文档（API.md，18 章节）
- TDD_SPEC.md 完善（v1.0 64 测试 → v2.0 97+4 占位测试）
- 13 个可执行 tracer-bullet ticket

### 产出文件清单

#### 架构决策记录（10 个 ADR，位于 `docs/architecture/`）
1. adr-0001-tech-stack.md — 技术栈选型（React 18 + TS + Node 20 + Fastify 4 + PostgreSQL 16，拒绝 Python/Next.js/Java）
2. adr-0002-authentication.md — 双 JWT 认证（家长/孩子分离 secret + token_version 即时吊销）
3. adr-0003-points-integrity.md — 积分完整性（SERIALIZABLE + UNIQUE + CHECK + balance_after 推导）
4. adr-0004-redemption-state-machine.md — 兑换状态机（pending→approved→fulfilled / rejected）
5. adr-0005-double-blind-review.md — 每周复盘双盲机制（双方提交后自动 lock）
6. adr-0006-multi-tenant-isolation.md — 多租户隔离（family_id 行级过滤 + 跨家庭 404）
7. adr-0007-frontend-state.md — 前端状态（TanStack Query + Zustand + React Router 三层）
8. adr-0008-deployment-topology.md — 部署拓扑（Vercel + Railway + Neon + GitHub Actions）
9. adr-0009-data-encryption.md — 字段级加密（AES-256-GCM + HKDF-SHA256 派生 per-row key）
10. adr-0010-background-jobs.md — 后台作业（node-cron in-process + withRetry 指数退避）

#### 主文档（位于 `docs/`）
- `ARCHITECTURE.md`（~1100 行）— C4 L1/L2/L3 图、模块边界、数据流、有限上下文、ADR 索引
- `API.md`（~900 行）— 18 章节，OpenAPI 风格，30+ 错误码字典
- `DETAILED_DESIGN.md`（~2070 行）— 12 章节：
  1. 领域模型（ER 图 + 10 实体）
  2. 状态机（兑换 / Child AccessToken / WeeklyReview 提交）
  3. 核心时序图（打卡 / 兑换审批 / 双盲复盘 / Token 验证）
  4. 关键算法（余额推导 / 维度点亮 / 任务可见性 / SERIALIZABLE 重试 / 字段加密）
  5. 数据完整性约束（11 CHECK + 7 UNIQUE + 3 triggers + 索引策略）
  6. 安全设计（认证矩阵 / 路由权限 / 多租户 / Zod / 限流 / Helmet / 日志脱敏 / 字段加密）
  7. 并发控制（隔离级别选择 / SERIALIZABLE 重试 / 乐观并发 / 幂等性 / 锁粒度 / 死锁防护）
  8. 性能设计（性能预算 / 前端 / 后端 / DB / 缓存策略 / 资源限制）
  9. 可观测性设计（日志分层 / 结构化日志 / Metrics / 链路追踪 / 健康检查 / 告警渠道）
  10. 错误处理与重试（统一响应格式 / 13 个错误码 / 自定义错误类 / 重试策略 / 错误边界）
  11. 数据库 Schema 完整定义（Drizzle ORM 全部 12 张表）
  12. 关键代码骨架（项目目录 / 后端入口 / Fastify app / 前端入口 / Repository / Service / 后台任务）

#### TDD_SPEC.md v2.0
- 原 v1.0：64 测试（20 unit + 28 integration + 14 component + 2 E2E）
- 新 v2.0：97 + 4 占位（23 unit + 56 integration + 14 component + 4 E2E + 4 Phase 2 占位）
- 新增章节：
  - §13 每周复盘（双盲机制）— 3 unit + 6 integration
  - §14 成长日记 — 5 integration
  - §15 并发与竞态 — 4 integration（含 SERIALIZABLE 重试 / 幂等性）
  - §16 安全与多租户隔离 — 3 多租户 + 3 JWT + 2 加密 = 8 integration
  - §17 错误流与边界条件 — 8 integration
  - §18 Phase 2 功能预占位 — 4 describe.skip
  - §19 性能与负载 — 2 E2E
  - §20 更新后的总计 + 优先级排序 + 覆盖度矩阵

#### Tracer-bullet Tickets（位于 `.scratch/growth-points-bank-mvp/issues/`）
13 个垂直切片 ticket，按依赖顺序编号：

| # | 标题 | 阻塞于 |
|---|------|--------|
| 01 | Project Scaffolding | — |
| 02 | Database Schema and Migrations | 01 |
| 03 | Auth and Multi-Tenancy Foundation | 02 |
| 04 | Family and Children CRUD | 03 |
| 05 | Tasks Management | 04 |
| 06 | Daily Check-In and Points Ledger | 05 |
| 07 | Rewards and Redemption Flow | 06 |
| 08 | Growth Map and Check-In Frontend | 06 |
| 09 | Weekly Review (Double-Blind) | 06 |
| 10 | Growth Diary with Field Encryption | 04 |
| 11 | Background Jobs Scheduler | 09, 07 |
| 12 | Security Hardening and Audit Log | 03 |
| 13 | Deployment and CI/CD | 01, 02, 06, 08 |

### 关键技术决策（自 grilling 内化）
- **不使用 SQLite**：改用 PGlite（in-memory PostgreSQL），与生产 PostgreSQL 方言一致，避免测试/生产行为漂移
- **不引入 Redis**：MVP 内存限流即可，Phase 2 再上 Redis 分布式锁
- **不引入 Prometheus/Grafana**：MVP 仅 pino + Sentry，Phase 2 引入
- **Phase 2 占位测试**：日打卡提醒 / 成就墙 / PDF 导出 / 任务模板按年龄段，使用 `describe.skip` 留位
- **跨家庭访问返回 404 而非 403**：防资源探测
- **余额不维护 balance 列**：从 `point_transactions.balance_after` 推导，单一可信源
- **字段加密仅敏感文本**：日记/复盘文本加密；积分/任务元数据/奖励元数据不加密（便于聚合查询）

### 已知风险（来自风险登记册，详见 ARCHITECTURE.md）
1. Railway Free Tier 512MB RAM 限制 → 监控 + 控制日志输出
2. Neon 免费分支数限制 → 预览环境需及时清理
3. PGlite 与生产 PostgreSQL 行为差异（如 trigger 支持有限）→ 关键 trigger 在集成测试用真 PostgreSQL 容器
4. node-cron in-process 在多实例部署时重复触发 → MVP 单实例；Phase 2 上分布式锁
5. 加密字段无法在 DB 层做 LIKE 查询 → 全文搜索 Phase 2 通过解密后扫描

### 下一步建议
1. **必须**：在新 session 中运行 `/architecture-review`（不能在本 session 跑，per skill 规则）验证架构一致性
2. **建议**：完成 review 后从 ticket #01 (Project Scaffolding) 开始实施，使用 `/implement` 一个个推进
3. **建议**：每个 ticket 完成后用 `/code-review` 审查
4. **建议**：MVP 全部 ticket 完成后运行 `/release-checklist` 做发布前清单

### 待清理临时文件
- `e:\git\` 根目录下的微信文章抓取脚本（等用户统一指示后清理）

---

## 2026-07-16 15:30 — GitHub 仓库创建 + architecture-review 全流程（CONCERNS → PASS）

### 本次工作目标
1. 使用 `gh` CLI 在 GitHub 上创建新仓库
2. 启动 `/architecture-review` 技能，验证架构完整性与一致性

### GitHub 仓库
- **仓库地址**: https://github.com/ZedeX/growth-points-bank
- **创建方式**: `gh repo create ZedeX/growth-points-bank --public --source=. --remote=origin --push`
- **默认分支**: master
- **最新提交**: `5c3b884` (docs(architecture): add ADR-0011/0012/0013, resolve 8 cross-ADR conflicts, PASS verdict)

### architecture-review 执行流程（9 阶段）
1. **Phase 1-3**: 加载 3 份设计文档 + 10 ADR，提取 70 个 TR（技术需求），构建可追溯性矩阵
   - 初始覆盖率：46 covered (65.7%) / 7 partial / 17 gap
2. **Phase 4**: 跨 ADR 冲突检测 → 发现 8 个冲突（3 个 BLOCKING）
3. **Phase 5-6**: 技术栈审计 + 文档覆盖度检查
4. **Phase 7**: 初次裁决 → 🟡 CONCERNS
5. **Phase 8**: 写入 3 份评审产物
6. **Phase 9**: 移交 + 用户选择"依次完成 ADR + 修订"

### 8 个跨 ADR 冲突及解决状态

| # | 冲突 | 解决方案 | 状态 |
|---|------|---------|------|
| 1 | Schema 名不一致（gpb_public vs app） | ARCHITECTURE.md 改为 `app` | ✅ |
| 2 | 目录结构冲突（单包 vs monorepo） | DETAILED_DESIGN §12.1 加废弃说明 | ✅ |
| 3 | 重试退避策略（linear vs exponential） | ADR-0003 改为 exponential `50 * 2^attempt` | ✅ |
| 4 | UNIQUE 索引范围（global vs per-child） | ADR-0003 改为 partial unique `(child_id, source_type, source_id) WHERE ...` | ✅ |
| 5 | BIGSERIAL PK 偏离 UUID 约定 | ADR-0005 加 rationale 注释（审计日志写性能） | ✅ |
| 6 | access_token 存储方式（ADR-0009 误称 Argon2） | ADR-0002 新增 HMAC-SHA256 子节；ADR-0009 修正引用 | ✅ |
| 7 | 加密阶段冲突（ADR-0005 skip vs ADR-0009 encrypted） | ADR-0009 新增 Phased Rollout 子节（Phase 1: children+diaries；Phase 2: weekly_reviews） | ✅ |
| 8 | Crypto API 不一致（crypto.subtle vs Node crypto） | ADR-0005 头改为 `Node.js crypto module` | ✅ |

### 新增 ADR（3 个 P0，覆盖 14 个 TR）

| ADR | 标题 | 覆盖 TR | 文件 |
|-----|------|---------|------|
| ADR-0011 | Task & Dimension Management | TR-tasks-001/002/003/004/006/007 (6) | `docs/architecture/adr-0011-task-and-dimension-management.md` |
| ADR-0012 | Reward Management | TR-rewards-001/002 (2) | `docs/architecture/adr-0012-reward-management.md` |
| ADR-0013 | Cross-Cutting Concerns | TR-xc-001/002/003/004 + TR-notify-001/002 (6) | `docs/architecture/adr-0013-cross-cutting-concerns.md` |

### 评审产物（3 份文件）
- `docs/architecture/architecture-review-2026-07-16.md` — 完整评审报告（11 节 + §12 re-run）
- `docs/architecture/requirements-traceability.md` — 70 TR 可追溯性矩阵（16 系统）
- `docs/architecture/tr-registry.yaml` — 机器可读 TR 注册表 + 冲突 + 裁决

### 修改文件清单（6 份）
- `docs/ARCHITECTURE.md` — Conflict #1 (schema name)
- `docs/DETAILED_DESIGN.md` — Conflict #2 (directory structure superseded note)
- `docs/architecture/adr-0002-authentication.md` — Conflict #6 part 1 (HMAC-SHA256 access_token storage)
- `docs/architecture/adr-0003-points-integrity.md` — Conflicts #3, #4 (exponential backoff + partial unique index)
- `docs/architecture/adr-0005-double-blind-review.md` — Conflicts #5, #8 (BIGSERIAL rationale + Node crypto header)
- `docs/architecture/adr-0009-data-encryption.md` — Conflicts #6 part 2/3, #7 (access_token ref fix + Phased Rollout)

### 重新评审结果
- **裁决**: ✅ **PASS (MVP Phase 1 scope)**
- **TR 覆盖率**: 65.7% → 85.7% (+20pp)
- **冲突解决率**: 8/8 (100%)
- **P0 缺口覆盖**: 14/14 TRs
- **Pre-Production gate**: ✅ CLEARED — 可进入 story 创建与实施阶段

### 剩余 P1/P2 缺口（不阻塞 MVP Phase 1）
| TR ID | 需求 | 建议 ADR | 阶段 |
|-------|------|---------|------|
| TR-diary-001 | 成长日记 CRUD | ADR-0014 | Phase 2 |
| TR-audit-001 | 审计日志 | ADR-0015 | Hardening |
| TR-xc-009 | 数据导出+30天删除 | ADR-0016 | Compliance |
| TR-report-001/002 | 报表与分析 | ADR-0017 | Phase 2 |

### 关键技术决策（本次新增）
- **HMAC-SHA256 用于 access_token 存储**: O(1) 查找 + DB 泄露保护 + 便宜轮换（不同于密码的 argon2 per-row 验证）
- **partial unique index 包含 child_id**: 防止多租户全局冲突 + 允许 revocation 行与 earn 行共存
- **exponential backoff 对齐**: ADR-0003 与 ADR-0010 + DETAILED_DESIGN §6.5 三处统一为 `50 * 2^attempt`
- **BIGSERIAL 审计日志 PK**: append-only + 写性能优先 + 索引 footprint 小（偏离 UUID 约定，有 rationale）
- **加密分期策略**: Phase 1 仅 children+diaries 字段加密；weekly_reviews 依赖 ADR-0005 API 层访问控制 + CHECK + 审计日志

### Git 操作
- 提交: `5c3b884` (12 files changed, +2625 lines, -9 lines)
- 推送: `970ec1d..5c3b884 master -> master`（直连，清空 proxy env vars）

### 下一步建议
1. 从 Issue #01 (Project Scaffolding) 开始实施，使用 `/implement` 逐个推进
2. 每个 ticket 完成后用 `/code-review` 审查
3. Phase 2 启动前补写 ADR-0014 (Growth Diary) 和 ADR-0017 (Reporting)
4. 合规审查前补写 ADR-0015 (Audit Log) 和 ADR-0016 (Data Lifecycle)


