# ADR-0010: 从 PostgreSQL 迁移到 SQLite

## Status
Accepted

## Date
2026-07-16

## Context

### Problem Statement
项目当前使用 PostgreSQL 作为数据库。在 CI 测试中遇到了严重的调试困难：
1. `pool.on('connect')` 中的 SET 查询与应用查询竞争同一连接，导致连接卡死
2. Fastify 4 的同步 preHandler（requireParent 等）返回 void 时会卡住请求处理
3. CI 需要启动 PostgreSQL 服务容器，增加了配置复杂度和调试时间
4. 每次推送后需要等待 5-15 分钟才能看到 CI 结果

### Constraints
- 项目是家庭积分银行，单家庭使用，低并发
- 不需要分布式部署
- 数据量小（每周几十条打卡记录）
- 需要字段加密（AES-256-GCM）
- Drizzle ORM 已支持 SQLite

### Requirements
- 测试能在本地秒级运行，无需安装数据库服务器
- CI 不需要数据库服务容器
- 保留事务支持和行级锁语义
- 保留字段加密能力

## Decision

**全面切换到 SQLite（better-sqlite3 驱动）**，包括开发、测试和生产。

### 具体变更
1. **驱动**: `pg` → `better-sqlite3`（同步驱动，最快）
2. **ORM**: `drizzle-orm/node-postgres` → `drizzle-orm/better-sqlite3`
3. **Schema**: 移除 `app.` 前缀，`uuid` → `text`，`timestamptz` → `text`
4. **事务**: `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` → `BEGIN IMMEDIATE`
5. **清理**: `TRUNCATE TABLE ... CASCADE` → `DELETE FROM ...`
6. **UUID**: 应用层生成（`crypto.randomUUID()`），不依赖数据库函数
7. **DATABASE_URL**: 连接字符串 → 文件路径（`data/gpb.db`）

### 架构图
```
Before:  App → Drizzle → node-postgres → PostgreSQL Server (port 5432)
After:   App → Drizzle → better-sqlite3 → SQLite File (data/gpb.db)
```

## Alternatives Considered

### Alternative 1: 仅测试用 PGlite
- **Description**: 保持 PostgreSQL，测试用 PGlite（WASM 版 PostgreSQL）
- **Pros**: 不需要改 schema 和 SQL
- **Cons**: PGlite 仍有序列化事务限制；CI 需要安装额外依赖；本地开发仍需 PostgreSQL
- **Rejection Reason**: 治标不治本，开发体验没有根本改善

### Alternative 2: 仅测试用 SQLite
- **Description**: 生产用 PostgreSQL，测试用 SQLite
- **Cons**: 需要维护两套 schema；SQL 兼容性问题；测试和生产行为不一致
- **Rejection Reason**: 双重维护成本高，违反"测试应尽可能接近生产"原则

## Consequences

### Positive
- 测试秒级完成（6秒 vs 之前 105秒+超时）
- 零配置：无需安装/启动数据库服务器
- CI 简化：移除 PostgreSQL 服务容器
- 部署简化：单二进制 + 单数据库文件
- better-sqlite3 是同步驱动，避免连接池竞争问题

### Negative
- 不支持并发写入（WAL 模式下有限并发读+单写）
- 不支持 `FOR UPDATE` 行锁（用 `BEGIN IMMEDIATE` 替代）
- 不支持 PostgreSQL 特有函数（`uuid_generate_v4()` 等）
- 备份策略变化（文件复制 vs pg_dump）

### Risks
- **写入并发**: 家庭场景下并发极低，风险可忽略
- **数据迁移**: 现有 PostgreSQL 数据需要导出/导入（当前无生产数据，无风险）
- **Drizzle ORM SQLite 成熟度**: Drizzle 对 SQLite 的支持成熟，风险低

## Migration Plan

### Phase 1: 依赖和 Schema 迁移
1. 安装 `better-sqlite3`，移除 `pg`
2. 重写 `db/schema.ts`（移除 `app.` 前缀，类型映射）
3. 重写 `db/client.ts`（better-sqlite3 驱动）
4. 重写 `db/migrate.ts`（SQLite DDL 语法）

### Phase 2: 服务层适配
1. 简化 `withSerializableRetry`（用 `BEGIN IMMEDIATE` 替代）
2. 移除 `SELECT ... FOR UPDATE`（IMMEDIATE 事务已锁定）
3. 应用层生成 UUID（`crypto.randomUUID()`）

### Phase 3: 测试适配
1. `cleanDatabase` 改用 `DELETE FROM`
2. `DATABASE_URL` 改为文件路径
3. 移除 CI 中的 PostgreSQL 服务容器

### Phase 4: 验证
1. 本地运行全部测试
2. CI 运行全部测试
3. 确认所有 88 个测试通过

## Validation Criteria
- 所有 88 个测试在 < 10 秒内通过
- CI 不再需要 PostgreSQL 服务容器
- 本地开发无需安装 PostgreSQL
