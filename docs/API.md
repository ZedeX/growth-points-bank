# 暑假成长积分银行 — API 文档

> **版本**: v1.0
> **创建日期**: 2026-07-16
> **关联**: [PRD.md](./PRD.md) · [TDD_SPEC.md](./TDD_SPEC.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)
> **基础 URL**: `https://api.growth-points-bank.example.com/api`
> **认证**: Bearer JWT (家长) 或 child_session cookie (孩子)

---

## 目录

1. [通用约定](#1-通用约定)
2. [认证机制](#2-认证机制)
3. [错误处理](#3-错误处理)
4. [Auth API](#4-auth-api)
5. [Family API](#5-family-api)
6. [Children API](#6-children-api)
7. [Tasks API](#7-tasks-api)
8. [Check-ins API](#8-check-ins-api)
9. [Points API](#9-points-api)
10. [Rewards API](#10-rewards-api)
11. [Redemptions API](#11-redemptions-api)
12. [Weekly Reviews API](#12-weekly-reviews-api)
13. [Growth Diaries API](#13-growth-diaries-api)
14. [Notifications API](#14-notifications-api)
15. [Health API](#15-health-api)
16. [数据 Schema 参考](#16-数据-schema-参考)
17. [错误码字典](#17-错误码字典)
18. [变更日志](#18-变更日志)

---

## 1. 通用约定

### 1.1 基础 URL

| 环境 | URL |
|------|-----|
| 生产 | `https://api.growth-points-bank.example.com/api` |
| Preview | `https://api-preview.growth-points-bank.example.com/api` |
| 本地开发 | `http://localhost:3000/api` |

### 1.2 请求约定

- **协议**: HTTPS only (生产)
- **方法**: GET, POST, PUT, PATCH, DELETE
- **请求体**: `application/json; charset=utf-8`
- **响应体**: `application/json; charset=utf-8`
- **时间格式**: ISO 8601 UTC (e.g., `"2026-07-16T10:00:00Z"`)
- **日期格式**: `YYYY-MM-DD` (e.g., `"2026-07-16"`)
- **ID 格式**: UUID v4
- **分页**: `?page=1&pageSize=20`，响应中包含 `pagination` 对象

### 1.3 限流

| 端点类别 | 限制 |
|---------|------|
| 认证 (login) | 5 次/15 分钟/IP |
| 通用 API | 100 次/分钟/用户 |
| 写操作 (POST/PATCH) | 30 次/分钟/用户 |

超限响应：`429 Too Many Requests`，响应头包含 `Retry-After`。

### 1.4 版本控制

- URL 路径不含版本（版本通过 `Accept` header 控制，目前 `application/json` 即 v1）
- 不兼容变更将引入新版本号，旧版本至少支持 6 个月

---

## 2. 认证机制

### 2.1 家长认证

家长通过 `Authorization` header 携带 JWT：

```
Authorization: Bearer <parent_jwt>
```

JWT payload:
```json
{
  "sub": "<parent_uuid>",
  "role": "parent",
  "family_id": "<family_uuid>",
  "iat": 1784134343,
  "exp": 1784739143
}
```

### 2.2 孩子认证

孩子通过链接 `https://app.growth-points-bank.example.com/child/auth?token=<access_token>` 进入，后端签发 `child_session` httpOnly cookie：

```
Cookie: child_session=<child_jwt>
```

JWT payload:
```json
{
  "sub": "<child_uuid>",
  "role": "child",
  "family_id": "<family_uuid>",
  "token_version": 1,
  "iat": 1784134343,
  "exp": 1784739143
}
```

### 2.3 Token 过期处理

- 过期返回 `401 Unauthorized` + `code: "TOKEN_EXPIRED"`
- 家长端通过 refresh token 端点续期（MVP 用 7 天长 token，Phase 2 引入 refresh token）
- 孩子端需重新扫码

---

## 3. 错误处理

### 3.1 错误响应格式

所有错误使用统一信封：

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "积分不足：需要 30 分，当前 10 分",
    "details": {
      "required": 30,
      "current": 10,
      "shortfall": 20
    },
    "requestId": "req_abc123"
  }
}
```

### 3.2 HTTP 状态码

| 状态码 | 含义 | 示例 code |
|--------|------|---------|
| 200 | 成功 (GET/PATCH) | - |
| 201 | 创建成功 (POST) | - |
| 204 | 无内容 (DELETE) | - |
| 400 | 请求错误 | VALIDATION_ERROR, INSUFFICIENT_BALANCE, INVALID_TRANSITION |
| 401 | 未认证 | UNAUTHORIZED, TOKEN_EXPIRED |
| 403 | 无权限 | FORBIDDEN |
| 404 | 不存在 | NOT_FOUND |
| 409 | 冲突 | CONFLICT, DUPLICATE_CHECKIN, REVIEW_LOCKED |
| 422 | 业务规则违反 | BUSINESS_RULE_VIOLATION |
| 429 | 限流 | RATE_LIMITED |
| 500 | 服务器错误 | INTERNAL_ERROR |
| 503 | 服务不可用 | SERVICE_UNAVAILABLE |

完整错误码字典见 [§17](#17-错误码字典)。

---

## 4. Auth API

### 4.1 POST /auth/register

家长注册。

**请求体**:
```json
{
  "email": "parent@test.com",
  "phone": "13800138000",
  "password": "Secure123!",
  "nickname": "测试妈妈",
  "family_name": "测试家庭"
}
```

> `email` 与 `phone` 至少提供一个；同时提供则两者皆可用作登录。

**响应 201**:
```json
{
  "parent": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "parent@test.com",
    "phone": "13800138000",
    "nickname": "测试妈妈",
    "created_at": "2026-07-16T10:00:00Z"
  },
  "family": {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "测试家庭",
    "summer_start_date": null,
    "summer_end_date": null
  },
  "token": "<parent_jwt>"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | 字段格式错误 / 密码强度不足 |
| 409 | EMAIL_TAKEN | 邮箱已注册 |
| 409 | PHONE_TAKEN | 手机号已注册 |

### 4.2 POST /auth/login

家长登录。

**请求体**:
```json
{
  "email_or_phone": "parent@test.com",
  "password": "Secure123!"
}
```

**响应 200**:
```json
{
  "parent": { ... },
  "family": { ... },
  "token": "<parent_jwt>"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 401 | INVALID_CREDENTIALS | 邮箱/手机号或密码错误 |
| 429 | RATE_LIMITED | 5 次失败后限流 15 分钟 |

### 4.3 POST /auth/refresh

刷新 token（Phase 2 实现，MVP 用 7 天长 token）。

### 4.4 POST /auth/logout

家长登出（MVP 客户端直接丢弃 token 即可；Phase 2 引入服务端黑名单）。

**响应 204**: 无内容

### 4.5 GET /auth/me

获取当前登录用户信息。

**响应 200**:
```json
{
  "parent": { ... },
  "family": { ... }
}
```

### 4.6 GET /child/auth

孩子通过链接登录。**非 JSON API**：成功后重定向到 `/child/map` 并设置 cookie。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `token` | string | 孩子 access_token（必填） |
| `redirect` | string | 登录后重定向路径（可选，默认 `/child/map`） |

**响应**:
- 成功：`302 Found`，`Set-Cookie: child_session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
- 失败：`404 Not Found` 或 `410 Gone`（token 已过期/被撤销）

---

## 5. Family API

### 5.1 GET /family

获取当前家庭信息。需要家长 token。

**响应 200**:
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "name": "测试家庭",
  "summer_start_date": "2026-07-01",
  "summer_end_date": "2026-08-31",
  "review_reminder_time": "18:00",
  "achievement_wall_enabled": false,
  "created_at": "2026-07-15T10:00:00Z"
}
```

### 5.2 PATCH /family

更新家庭设置。

**请求体** (所有字段可选):
```json
{
  "name": "新家庭名",
  "summer_start_date": "2026-07-01",
  "summer_end_date": "2026-08-31",
  "review_reminder_time": "19:00",
  "achievement_wall_enabled": true
}
```

**响应 200**: 返回更新后的家庭对象

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | 日期格式错误 / review_reminder_time 不在 00:00-23:59 |
| 400 | INVALID_DATE_RANGE | summer_end_date <= summer_start_date |

---

## 6. Children API

### 6.1 POST /children

创建孩子档案。需要家长 token。

**请求体**:
```json
{
  "name": "小明",
  "age_group": "6-8",
  "avatar": null
}
```

**响应 201**:
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "family_id": "660e8400-...",
  "name": "小明",
  "age_group": "6-8",
  "avatar": null,
  "created_at": "2026-07-16T10:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | name 为空 / age_group 不在枚举内 |
| 400 | NAME_TOO_LONG | name 超过 30 字符 |

### 6.2 GET /children

获取孩子列表。需要家长 token。

**响应 200**:
```json
{
  "children": [
    {
      "id": "770e8400-...",
      "name": "小明",
      "age_group": "6-8",
      "avatar": null,
      "created_at": "2026-07-16T10:00:00Z"
    }
  ]
}
```

### 6.3 GET /children/:id

获取单个孩子详情。

### 6.4 PATCH /children/:id

更新孩子档案（姓名、头像、年龄段）。

### 6.5 DELETE /children/:id

删除孩子档案。**级联删除**：打卡、积分流水、兑换记录、复盘、日记一并删除。

**响应 204**: 无内容

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 404 | NOT_FOUND | 孩子 ID 不存在或跨家庭 |
| 400 | HAS_ACTIVE_REDEMPTIONS | 存在 `pending` 或 `approved` 状态的兑换，需先处理 |

### 6.6 POST /children/:id/access-token

生成（或重新生成）孩子的访问令牌。

**响应 200**:
```json
{
  "access_token": "atk_abc123...",
  "expires_at": "2026-07-23T10:00:00Z",
  "access_url": "https://app.growth-points-bank.example.com/child/auth?token=atk_abc123..."
}
```

**注意**: 重新生成会使旧 token 立即失效（bumps `token_version`）。

### 6.7 DELETE /children/:id/access-token

撤销孩子的当前访问令牌（不删除孩子档案）。

**响应 204**: 无内容

---

## 7. Tasks API

### 7.1 POST /tasks

创建任务。需要家长 token。

**请求体**:
```json
{
  "title": "阅读30分钟",
  "dimension_id": 1,
  "point_value": 2,
  "frequency": "daily",
  "description": "可选描述"
}
```

**响应 201**:
```json
{
  "id": "880e8400-...",
  "family_id": "660e8400-...",
  "title": "阅读30分钟",
  "dimension_id": 1,
  "point_value": 2,
  "frequency": "daily",
  "description": "可选描述",
  "is_active": true,
  "created_at": "2026-07-16T10:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | title 为空 / 超过 30 字符 |
| 400 | INVALID_DIMENSION | dimension_id 不在 1-5（或自定义维度范围内） |
| 400 | INVALID_POINT_VALUE | point_value 不在 1-20 |
| 400 | INVALID_FREQUENCY | frequency 不在 daily/weekly/once |

### 7.2 GET /tasks

获取任务列表。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `dimension_id` | int | 按维度筛选 |
| `is_active` | bool | 按启用状态筛选 |
| `frequency` | string | 按频率筛选 |

**响应 200**:
```json
{
  "tasks": [ { ... } ]
}
```

### 7.3 GET /tasks/:id

获取单个任务详情。

### 7.4 PATCH /tasks/:id

更新任务。

**请求体** (所有字段可选):
```json
{
  "title": "阅读45分钟",
  "dimension_id": 1,
  "point_value": 3,
  "frequency": "daily",
  "description": "更新后的描述",
  "is_active": true
}
```

**响应 200**: 返回更新后的任务对象

### 7.5 DELETE /tasks/:id

删除任务。**保留历史打卡记录**。

**响应 204**: 无内容

### 7.6 GET /tasks/templates

获取任务模板列表（按年龄段分类）。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `age_group` | string | 6-8 / 9-11 / 12-14 |

**响应 200**:
```json
{
  "templates": [
    {
      "title": "阅读30分钟",
      "dimension_id": 1,
      "point_value": 2,
      "frequency": "daily",
      "description": "..."
    }
  ]
}
```

### 7.7 GET /dimensions

获取所有成长维度（含预置和自定义）。

**响应 200**:
```json
{
  "dimensions": [
    { "id": 1, "name": "学习力", "icon": "book", "color": "#2196F3", "sort_order": 1 },
    { "id": 2, "name": "运动力", "icon": "run", "color": "#FF9800", "sort_order": 2 },
    ...
  ]
}
```

---

## 8. Check-ins API

### 8.1 POST /checkins

打卡（标记任务完成）。需要孩子 token（或家长代打卡）。

**请求体**:
```json
{
  "task_id": "880e8400-...",
  "date": "2026-07-16"
}
```

> `date` 默认为今天；不可为过去日期。

**响应 201**:
```json
{
  "id": "990e8400-...",
  "task_id": "880e8400-...",
  "date": "2026-07-16",
  "points_earned": 2,
  "balance_after": 12,
  "created_at": "2026-07-16T10:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | date 为空 / 格式错误 |
| 400 | CHECKIN_PAST_DATE | 不可补打卡（过去日期） |
| 400 | CHECKIN_FUTURE_DATE | 不可预打卡（未来日期） |
| 404 | NOT_FOUND | task_id 不存在或跨家庭 |
| 409 | DUPLICATE_CHECKIN | 当日已打卡该任务 |
| 422 | TASK_NOT_ACTIVE | 任务已停用 |
| 422 | TASK_COMPLETED_ONCE | 一次性任务已完成 |

### 8.2 GET /checkins/today

获取今日打卡列表。需要孩子 token。

**查询参数**: 无（自动从 JWT 获取 child_id）

**响应 200**:
```json
{
  "checkins": [
    {
      "id": "990e8400-...",
      "task_id": "880e8400-...",
      "task_title": "阅读30分钟",
      "dimension_id": 1,
      "point_value": 2,
      "date": "2026-07-16",
      "revoked_by_parent": false,
      "created_at": "2026-07-16T10:00:00Z"
    }
  ],
  "summary": {
    "total_tasks_today": 8,
    "completed_today": 3,
    "points_earned_today": 6
  }
}
```

### 8.3 GET /checkins

获取打卡历史。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子（孩子端忽略） |
| `date_from` | date | 起始日期 |
| `date_to` | date | 结束日期 |
| `dimension_id` | int | 按维度筛选 |
| `page` | int | 页码（默认 1） |
| `pageSize` | int | 每页数量（默认 20，最大 100） |

**响应 200**:
```json
{
  "checkins": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 53,
    "totalPages": 3
  }
}
```

### 8.4 DELETE /checkins/:id

取消打卡（扣除已得积分）。

**响应 200**:
```json
{
  "id": "990e8400-...",
  "status": "cancelled",
  "balance_after": 10
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 404 | NOT_FOUND | 打卡记录不存在 |
| 403 | FORBIDDEN | 非本人打卡 / 已被家长撤销的不可取消 |
| 409 | CHECKIN_REVOKED | 已被家长撤销的打卡 |

### 8.5 POST /checkins/:id/revoke

家长撤销不实打卡。

**请求体** (可选):
```json
{
  "reason": "未实际完成"
}
```

**响应 200**:
```json
{
  "id": "990e8400-...",
  "status": "revoked",
  "revoked_by_parent": true,
  "revoked_at": "2026-07-16T11:00:00Z",
  "balance_after": 10
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 403 | FORBIDDEN | 非家长角色 |
| 404 | NOT_FOUND | 打卡不存在或跨家庭 |
| 409 | ALREADY_REVOKED | 已撤销 |
| 403 | CROSS_FAMILY | 跨家庭撤销 |

---

## 9. Points API

### 9.1 GET /points/balance

获取积分余额。

**响应 200**:
```json
{
  "child_id": "770e8400-...",
  "balance": 50,
  "total_earned": 80,
  "total_spent": 30,
  "updated_at": "2026-07-16T11:00:00Z"
}
```

### 9.2 GET /points/transactions

获取积分流水。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子 |
| `source_type` | string | task / reward / revocation |
| `date_from` | datetime | 起始时间 |
| `date_to` | datetime | 结束时间 |
| `page` | int | 页码 |
| `pageSize` | int | 每页数量 |

**响应 200**:
```json
{
  "transactions": [
    {
      "id": "aa0e8400-...",
      "child_id": "770e8400-...",
      "amount": 2,
      "source_type": "task",
      "source_id": "990e8400-...",
      "source_label": "阅读30分钟",
      "balance_after": 12,
      "created_at": "2026-07-16T10:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

### 9.3 GET /points/summary

按维度/时间汇总积分。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子 |
| `group_by` | string | dimension / week / month |
| `date_from` | date | 起始日期 |
| `date_to` | date | 结束日期 |

**响应 200**:
```json
{
  "groups": [
    {
      "key": "1",
      "label": "学习力",
      "total_earned": 20,
      "total_spent": 0,
      "net": 20
    }
  ],
  "total_earned": 80,
  "total_spent": 30,
  "balance": 50
}
```

---

## 10. Rewards API

### 10.1 POST /rewards

创建奖励。需要家长 token。

**请求体**:
```json
{
  "tier": "small",
  "title": "家庭电影",
  "description": "选择一次家庭电影",
  "point_cost": 10
}
```

**响应 201**:
```json
{
  "id": "bb0e8400-...",
  "family_id": "660e8400-...",
  "tier": "small",
  "title": "家庭电影",
  "description": "选择一次家庭电影",
  "point_cost": 10,
  "is_active": true,
  "created_at": "2026-07-16T10:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | title 为空 / point_cost < 1 |
| 400 | INVALID_TIER | tier 不在 small/medium/large |

### 10.2 GET /rewards

获取奖励列表。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `tier` | string | 按档位筛选 |
| `is_active` | bool | 按启用状态 |

**响应 200**:
```json
{
  "rewards": [ ... ]
}
```

### 10.3 GET /rewards/:id

获取单个奖励详情。

### 10.4 PATCH /rewards/:id

更新奖励。

### 10.5 DELETE /rewards/:id

删除奖励。**保留历史兑换记录**。

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 409 | HAS_PENDING_REDEMPTIONS | 存在 pending 状态的兑换 |

---

## 11. Redemptions API

### 11.1 POST /redemptions

孩子发起兑换请求。需要孩子 token（或家长代发）。

**请求体**:
```json
{
  "reward_id": "bb0e8400-...",
  "child_note": "我坚持了一周阅读才换的"
}
```

**响应 201**:
```json
{
  "id": "cc0e8400-...",
  "child_id": "770e8400-...",
  "reward_id": "bb0e8400-...",
  "reward_title": "家庭电影",
  "point_cost": 10,
  "child_note": "我坚持了一周阅读才换的",
  "status": "pending",
  "balance_after": 50,
  "created_at": "2026-07-16T10:00:00Z"
}
```

> 注意：发起时积分未扣；审批通过时扣。

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | child_note 为空或超 100 字 |
| 400 | INSUFFICIENT_BALANCE | 积分不足 |
| 404 | NOT_FOUND | reward_id 不存在或跨家庭 |
| 422 | REWARD_INACTIVE | 奖励已停用 |
| 409 | HAS_PENDING_REDEMPTION | 已有同奖励的 pending 兑换 |

### 11.2 GET /redemptions

获取兑换列表。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子 |
| `status` | string | pending / approved / rejected / fulfilled |
| `page` | int | 页码 |

**响应 200**:
```json
{
  "redemptions": [
    {
      "id": "cc0e8400-...",
      "child_id": "770e8400-...",
      "reward_id": "bb0e8400-...",
      "reward_title": "家庭电影",
      "point_cost": 10,
      "child_note": "...",
      "parent_note": null,
      "status": "pending",
      "created_at": "2026-07-16T10:00:00Z",
      "reviewed_at": null,
      "fulfilled_at": null,
      "last_reminder_sent_at": null
    }
  ],
  "pagination": { ... }
}
```

### 11.3 GET /redemptions/:id

获取单个兑换详情。

### 11.4 PATCH /redemptions/:id/approve

家长审核通过。

**请求体** (可选):
```json
{
  "parent_note": "表现很好，批准"
}
```

**响应 200**:
```json
{
  "id": "cc0e8400-...",
  "status": "approved",
  "parent_note": "表现很好，批准",
  "reviewed_at": "2026-07-16T11:00:00Z",
  "balance_after": 40
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 403 | FORBIDDEN | 非家长角色 |
| 400 | INVALID_TRANSITION | 当前状态不是 pending |
| 400 | INSUFFICIENT_BALANCE | 兑换期间积分已被消费，余额不足（提示重新审核或拒绝） |

### 11.5 PATCH /redemptions/:id/reject

家长拒绝。

**请求体**:
```json
{
  "parent_note": "再坚持一周"
}
```

**响应 200**:
```json
{
  "id": "cc0e8400-...",
  "status": "rejected",
  "parent_note": "再坚持一周",
  "reviewed_at": "2026-07-16T11:00:00Z",
  "balance_after": 50
}
```

### 11.6 PATCH /redemptions/:id/fulfill

家长标记已兑现。

**响应 200**:
```json
{
  "id": "cc0e8400-...",
  "status": "fulfilled",
  "fulfilled_at": "2026-07-17T15:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | INVALID_TRANSITION | 当前状态不是 approved |

---

## 12. Weekly Reviews API

> Phase 2 功能

### 12.1 GET /reviews

获取复盘列表或单个详情。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子 |
| `week_start` | date | 获取特定周复盘（详情模式） |
| `page` | int | 列表模式页码 |

**响应 200** (列表模式):
```json
{
  "reviews": [
    {
      "id": "dd0e8400-...",
      "week_start_date": "2026-07-13",
      "child_committed_at": "2026-07-19T10:00:00Z",
      "parent_committed_at": "2026-07-19T18:00:00Z",
      "locked_at": "2026-07-19T18:00:00Z",
      "task_count": 15,
      "point_earned": 30,
      "dimension_count": 4
    }
  ]
}
```

**响应 200** (详情模式，孩子请求者):
```json
{
  "id": "dd0e8400-...",
  "week_start_date": "2026-07-13",
  "best_thing": "我这周最棒的事是...",
  "difficulty": "遇到的困难是...",
  "child_request": "希望妈妈...",
  "self_committed": true,
  "locked": true,
  "other": {
    "parent_observation": "妈妈看见你..."
  },
  "aggregate": {
    "task_count": 15,
    "point_earned": 30,
    "dimension_count": 4
  }
}
```

**响应 200** (仅自己已提交，对方未提交):
```json
{
  "self_committed": true,
  "locked": false,
  "other": {
    "status": "other_committed_waiting_for_you"  // 或 "other_not_started"
  }
}
```

### 12.2 POST /reviews/child

孩子提交复盘内容。

**请求体**:
```json
{
  "week_start_date": "2026-07-13",
  "best_thing": "我这周最棒的事是...",
  "difficulty": "遇到的困难是...",
  "child_request": "希望妈妈..."
}
```

**响应 200**:
```json
{
  "id": "dd0e8400-...",
  "self_committed": true,
  "locked": false
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 409 | REVIEW_LOCKED | 已锁定，不可修改 |
| 400 | VALIDATION_ERROR | 字段为空 / 超过 200 字 |

### 12.3 POST /reviews/parent

家长提交复盘内容。

**请求体**:
```json
{
  "week_start_date": "2026-07-13",
  "parent_observation": "妈妈看见你..."
}
```

### 12.4 GET /reviews/aggregate

获取某周数据汇总（自动计算）。

---

## 13. Growth Diaries API

### 13.1 POST /diaries

创建日记。需要孩子 token（或家长代记）。

**请求体**:
```json
{
  "title": "今天做了好吃的",
  "content": "我做了番茄炒蛋...",
  "category": "做饭记录"
}
```

**响应 201**:
```json
{
  "id": "ee0e8400-...",
  "child_id": "770e8400-...",
  "title": "今天做了好吃的",
  "content": "我做了番茄炒蛋...",
  "category": "做饭记录",
  "created_at": "2026-07-16T20:00:00Z"
}
```

**错误**:
| 状态码 | code | 场景 |
|--------|------|------|
| 400 | VALIDATION_ERROR | title/content 为空 |
| 400 | INVALID_CATEGORY | category 不在枚举 |

### 13.2 GET /diaries

获取日记列表。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `child_id` | UUID | 家长查询指定孩子 |
| `category` | string | 分类筛选 |
| `date_from` | date | 起始日期 |
| `date_to` | date | 结束日期 |
| `page` | int | 页码 |
| `pageSize` | int | 每页 |

**响应 200**:
```json
{
  "diaries": [
    {
      "id": "ee0e8400-...",
      "title": "今天做了好吃的",
      "content": "我做了番茄炒蛋...",
      "category": "做饭记录",
      "created_at": "2026-07-16T20:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

### 13.3 GET /diaries/:id

获取日记详情。

### 13.4 PATCH /diaries/:id

更新日记（创建后 24 小时内可改；超时不可）。

### 13.5 DELETE /diaries/:id

删除日记。

---

## 14. Notifications API

### 14.1 GET /notifications

获取通知列表。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `is_read` | bool | 按已读状态 |
| `type` | string | weekly_review_reminder / fulfillment_reminder |

**响应 200**:
```json
{
  "notifications": [
    {
      "id": "ff0e8400-...",
      "type": "weekly_review_reminder",
      "title": "本周复盘时间到啦",
      "body": "点击进入每周复盘",
      "is_read": false,
      "created_at": "2026-07-21T10:00:00Z"
    }
  ]
}
```

### 14.2 POST /notifications/:id/read

标记单条通知已读。

### 14.3 POST /notifications/read-all

标记所有通知已读。

---

## 15. Health API

### 15.1 GET /health

健康检查端点（无认证）。

**响应 200**:
```json
{
  "status": "ok",
  "uptime": 3600,
  "db": "ok",
  "version": "1.0.0",
  "commitSha": "abc1234"
}
```

### 15.2 GET /health/ready

Readiness 探针。仅当 DB 可达且迁移已应用时返回 200。

---

## 16. 数据 Schema 参考

### 16.1 枚举类型

```typescript
// packages/shared/enums.ts

export const AgeGroup = {
  YOUNG: '6-8',
  MIDDLE: '9-11',
  OLD: '12-14',
} as const;

export const Frequency = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  ONCE: 'once',
} as const;

export const RedemptionStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FULFILLED: 'fulfilled',
} as const;

export const RewardTier = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
} as const;

export const DiaryCategory = {
  DRAWING: '画画记录',
  DIARY: '日记',
  COOKING: '做饭记录',
  EXPERIMENT: '实验记录',
  SPORTS: '运动记录',
  OTHER: '其他',
} as const;

export const TransactionSourceType = {
  TASK: 'task',
  REWARD: 'reward',
  REVOCATION: 'revocation',
} as const;
```

### 16.2 Zod Schemas (摘录)

```typescript
// packages/shared/schemas/task.ts

import { z } from 'zod';

export const TaskCreateSchema = z.object({
  title: z.string().min(1).max(30),
  dimension_id: z.number().int().positive(),
  point_value: z.number().int().min(1).max(20),
  frequency: z.enum(['daily', 'weekly', 'once']),
  description: z.string().max(200).optional(),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskUpdateSchema = TaskCreateSchema.partial();
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

export const TaskResponseSchema = z.object({
  id: z.string().uuid(),
  family_id: z.string().uuid(),
  title: z.string(),
  dimension_id: z.number().int(),
  point_value: z.number().int(),
  frequency: z.enum(['daily', 'weekly', 'once']),
  description: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
});
```

---

## 17. 错误码字典

| code | HTTP | 描述 | 触发场景 |
|------|------|------|---------|
| `VALIDATION_ERROR` | 400 | 请求体校验失败 | Zod 解析失败 |
| `INSUFFICIENT_BALANCE` | 400 | 积分不足 | 兑换审核时余额不足 |
| `INVALID_TRANSITION` | 400 | 状态机非法转换 | 兑换已拒绝再审核 |
| `INVALID_DIMENSION` | 400 | 维度 ID 非法 | dimension_id 不存在 |
| `INVALID_POINT_VALUE` | 400 | 积分值非法 | point_value 不在 1-20 |
| `INVALID_FREQUENCY` | 400 | 频率非法 | frequency 不在枚举 |
| `INVALID_TIER` | 400 | 档位非法 | tier 不在 small/medium/large |
| `INVALID_CATEGORY` | 400 | 日记分类非法 | category 不在枚举 |
| `INVALID_DATE_RANGE` | 400 | 日期范围非法 | summer_end <= summer_start |
| `CHECKIN_PAST_DATE` | 400 | 补打卡 | date < today |
| `CHECKIN_FUTURE_DATE` | 400 | 预打卡 | date > today |
| `NAME_TOO_LONG` | 400 | 名称超长 | child name > 30 字符 |
| `EMAIL_TAKEN` | 409 | 邮箱已注册 | 注册时重复 |
| `PHONE_TAKEN` | 409 | 手机号已注册 | 注册时重复 |
| `DUPLICATE_CHECKIN` | 409 | 重复打卡 | 同日同任务已打卡 |
| `ALREADY_REVOKED` | 409 | 已撤销 | 重复撤销 |
| `REVIEW_LOCKED` | 409 | 复盘已锁定 | 锁定后修改 |
| `HAS_PENDING_REDEMPTIONS` | 409 | 存在待处理兑换 | 删除孩子/奖励前检查 |
| `HAS_PENDING_REDEMPTION` | 409 | 已有同奖励 pending | 重复发起兑换 |
| `TASK_NOT_ACTIVE` | 422 | 任务已停用 | 打卡时检查 |
| `TASK_COMPLETED_ONCE` | 422 | 一次性任务已完成 | 重复打卡 once 任务 |
| `REWARD_INACTIVE` | 422 | 奖励已停用 | 发起兑换时检查 |
| `UNAUTHORIZED` | 401 | 未认证 | 缺失/无效 token |
| `TOKEN_EXPIRED` | 401 | Token 过期 | JWT exp 已过 |
| `INVALID_CREDENTIALS` | 401 | 凭证错误 | 登录失败 |
| `FORBIDDEN` | 403 | 无权限 | 角色不匹配 |
| `CROSS_FAMILY` | 403 | 跨家庭操作 | 跨家庭撤销 |
| `NOT_FOUND` | 404 | 不存在 | 资源不存在或跨家庭 |
| `RATE_LIMITED` | 429 | 限流 | 超频 |
| `INTERNAL_ERROR` | 500 | 服务器错误 | 未捕获异常 |
| `SERVICE_UNAVAILABLE` | 503 | 服务不可用 | 健康检查失败 |

---

## 18. 变更日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-16 | 初始版本：MVP 接口全集（auth/family/children/tasks/checkins/points/rewards/redemptions），Phase 2 接口预定义（reviews/diaries/notifications） |
