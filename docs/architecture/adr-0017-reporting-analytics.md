# ADR-0017: Reporting & Analytics (Weekly/Monthly Aggregation + Trend Visualization)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 (window functions, CTEs) + React 18 + Recharts (Phase 2) |
| Domain | Reporting / Analytics / Aggregation |
| Knowledge Risk | LOW — SQL aggregation and React charts are well-trodden territory |
| References Consulted | PRD §5.2 (报表功能), §3.2 (成长地图); DETAILED_DESIGN §4.3 (维度点亮算法); ADR-0003 (Points Integrity — `balance_after` derivation) |
| Post-Cutoff APIs Used | None |
| Verification Required | None for MVP; Phase 2 verifies Recharts 2.x compat with React 18 |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0003 (Points Integrity — `point_transactions` is the source of truth), ADR-0006 (Multi-tenant — `family_id` scope), ADR-0011 (Tasks — dimension mapping) |
| Enables | PRD §5.2 "成长报表" feature; parent dashboard charts |
| Blocks | None |
| Ordering Note | MVP ships read-only aggregation queries; visualization (charts) is Phase 2 |

## Context

### Problem Statement
PRD §5.2 asks for "growth reports" — weekly/monthly summaries per child, broken down by dimension, with trend visualization (line chart for points over time, radar chart for dimension balance). The architecture must answer:

1. **Aggregation source** — Do we pre-aggregate into a summary table, or compute on-the-fly from `point_transactions`?
2. **Query contracts** — What endpoints serve the parent dashboard charts?
3. **Visualization** — What library, and when does it land?
4. **Performance** — A family with 2 children, 90 days of data, 5 dimensions: how expensive is the aggregation?

### Constraints
- MVP runs on Railway Hobby (512MB RAM) — no in-memory OLAP cube.
- `point_transactions` is the single source of truth (ADR-0003) — no materialized `balance` column.
- Multi-tenant isolation (ADR-0006) — all queries filter by `family_id`.
- Encrypted fields (ADR-0009) cannot be aggregated server-side — but points and check-in counts are plaintext.

### Requirements
- **TR-report-001**: Growth reports — weekly/monthly per-child aggregation by dimension (task count, points earned, dimension count).
- **TR-report-002**: Data visualization — trend chart (points over time) and dimension radar (5-axis).
- **TR-report-003** (implied): Aggregation queries run in <500ms for MVP-scale data (2 children × 90 days × 5 dimensions ≈ 900 rows).

## Decision

### 1. On-the-Fly Aggregation (No Summary Table)

MVP computes aggregations on-the-fly from `point_transactions` + `checkins` + `tasks` using SQL `GROUP BY` and window functions. No pre-aggregated summary table is introduced.

Rationale:
- MVP scale is tiny (≤ 1000 rows per family per quarter) — PostgreSQL handles this in <50ms with proper indexes.
- A summary table introduces sync complexity (when to refresh? on every check-in? on a schedule?) without measurable performance benefit at MVP scale.
- Phase 2 may add a materialized view if scale demands it — but the API contract stays the same.

### 2. Query Contracts

#### Endpoint 1: Weekly Summary (per child)

```
GET /api/reports/weekly?child_id=<uuid>&week_start_date=YYYY-MM-DD
  Authorization: Bearer <parent_jwt> or <child_jwt>
  Response:
  {
    child_id: string,
    week_start_date: string,
    task_count: number,             // total check-ins (non-revoked) in the week
    points_earned: number,          // sum of positive point_transactions.amount
    points_spent: number,           // sum of negative point_transactions.amount (absolute value)
    dimension_breakdown: [
      { dimension_code: 'learning', dimension_name: '学习力', color: '#2196F3', task_count: 3, points_earned: 30 },
      { dimension_code: 'sports', dimension_name: '运动力', color: '#FF9800', task_count: 2, points_earned: 20 },
      ...
    ]
  }
```

SQL sketch:
```sql
SELECT
  d.code, d.name, d.color,
  COUNT(c.id) AS task_count,
  COALESCE(SUM(pt.amount), 0) AS points_earned
FROM app.tasks t
JOIN app.growth_dimensions d ON d.id = t.dimension_id
LEFT JOIN app.checkins c ON c.task_id = t.id
  AND c.child_id = $1
  AND c.date BETWEEN $2 AND ($2::date + INTERVAL '6 days')::date
  AND c.revoked_by_parent = false
LEFT JOIN app.point_transactions pt ON pt.source_type = 'task'
  AND pt.source_id = c.id
  AND pt.amount > 0
WHERE t.family_id = $3
GROUP BY d.code, d.name, d.color
ORDER BY d.sort_order;
```

#### Endpoint 2: Monthly Trend (per child)

```
GET /api/reports/trend?child_id=<uuid>&months=3
  Authorization: Bearer <parent_jwt> or <child_jwt>
  Response:
  {
    child_id: string,
    trend: [
      { month: '2026-05', points_earned: 120, points_spent: 50, task_count: 24 },
      { month: '2026-06', points_earned: 180, points_spent: 80, task_count: 36 },
      { month: '2026-07', points_earned: 95, points_spent: 30, task_count: 19 },
    ]
  }
```

SQL sketch (using `date_trunc`):
```sql
SELECT
  TO_CHAR(DATE_TRUNC('month', pt.created_at), 'YYYY-MM') AS month,
  SUM(CASE WHEN pt.amount > 0 THEN pt.amount ELSE 0 END) AS points_earned,
  SUM(CASE WHEN pt.amount < 0 THEN ABS(pt.amount) ELSE 0 END) AS points_spent,
  COUNT(CASE WHEN pt.source_type = 'task' THEN 1 END) AS task_count
FROM app.point_transactions pt
WHERE pt.child_id = $1
  AND pt.created_at >= NOW() - INTERVAL '$2 months'
GROUP BY DATE_TRUNC('month', pt.created_at)
ORDER BY month;
```

#### Endpoint 3: Family Overview (parent dashboard)

```
GET /api/reports/family-overview
  Authorization: Bearer <parent_jwt>
  Response:
  {
    children: [
      {
        child_id: string,
        child_name: string,
        balance: number,
        week_points_earned: number,
        week_task_count: number,
        pending_redemptions: number
      }
    ]
  }
```

### 3. Visualization: Phase 2

MVP serves raw JSON; the frontend renders simple numeric cards (no charts). Phase 2 introduces Recharts:

- **Line chart** — points earned vs. spent over 3 months (Endpoint 2 data)
- **Radar chart** — 5-dimension balance (Endpoint 1 `dimension_breakdown`)
- **Bar chart** — weekly task count comparison across siblings

Recharts 2.x is compatible with React 18; bundle size (~95KB gzipped) is acceptable for a parent-only dashboard (child views have no charts).

### 4. Index Strategy

The following indexes (already in `schema.ts`) support the aggregation queries:

- `idx_point_tx_child_created` on `point_transactions(child_id, created_at DESC)` — Endpoint 2 trend
- `idx_checkins_child_date` on `checkins(child_id, date)` — Endpoint 1 weekly
- `idx_tasks_family` on `tasks(family_id)` — Endpoint 1 dimension join

No additional indexes are required for MVP-scale data.

### 5. Caching

MVP: No caching. Each request recomputes the aggregation. Acceptable for MVP scale (≤ 1000 rows per family).

Phase 2: In-memory cache (TTL 60s) keyed by `(family_id, child_id, week_start_date)`. Invalidated on new check-in or redemption.

### 6. Multi-Tenant Isolation

All queries filter by `family_id` derived from the JWT (per ADR-0006). A parent can query any child in their family; a child can only query themselves. Cross-family access returns 404 (per ADR-0006 — never 403).

## Consequences

### Positive
- ✅ On-the-fly aggregation avoids sync complexity; data is always fresh.
- ✅ SQL window functions + proper indexes keep queries under 50ms at MVP scale.
- ✅ JSON contract is stable — Phase 2 visualization can consume the same endpoints.
- ✅ No materialized view or summary table reduces schema complexity.

### Negative
- ⚠️ Aggregation queries will slow as data grows. Phase 2 may need a materialized view refreshed by a scheduled job (ADR-0010).
- ⚠️ No charts in MVP — the parent dashboard is text-only. UX trade-off documented.
- ⚠️ No caching — repeat requests recompute. Acceptable for MVP (low traffic).

### Neutral
- Recharts defers to Phase 2 — no bundle size impact in MVP.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Aggregation query exceeds 500ms at scale | LOW (MVP) / MEDIUM (Phase 2) | Phase 2 adds materialized view + 60s cache |
| Recharts bundle bloats parent dashboard | LOW | Phase 2: code-split Recharts into a lazy-loaded chunk |
| Encrypted diary content cannot be aggregated | LOW | Reporting is based on plaintext points/checkins; diary text is not aggregated |

## Open Questions

- **Phase 2 materialized view refresh strategy** — On every check-in? On a schedule? Deferred to Phase 2 design.
- **Sibling comparison chart** — PRD §5.2 hints at "compare siblings"; MVP skips this. Phase 2 will add an endpoint.
