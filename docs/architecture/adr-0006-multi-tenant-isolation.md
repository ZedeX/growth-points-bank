# ADR-0006: Multi-Tenant Data Isolation via `family_id` Row-Level Filtering

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | PostgreSQL 16 + Drizzle ORM |
| Domain | Data Security / Multi-Tenancy |
| Knowledge Risk | LOW — application-level multi-tenancy is standard |
| References Consulted | PRD §4.2 (多孩子管理), §7.3 (数据安全) |
| Post-Cutoff APIs Used | None |
| Verification Required | Cross-family access test (negative test) |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0002 (Auth — provides family_id claim) |
| Enables | All data access (every query must filter by family_id) |
| Blocks | All epics involving data persistence |
| Ordering Note | Pattern must be established before any data access code is written |

## Context

### Problem Statement
The app stores data for multiple families. A bug that leaks data across families is a critical security incident (one parent seeing another family's children/data). Specifically:
- `tasks`, `rewards`, `redemptions`, `weekly_reviews`, `growth_diaries` all have `family_id` or `child_id` (which transitively belongs to a family)
- Auth (ADR-0002) provides `request.auth.family_id` from JWT claim
- Every query must be scoped to that `family_id`; otherwise cross-family leak

The risk: a developer writes `SELECT * FROM tasks WHERE id = ?` without `AND family_id = ?`, and an attacker guesses another family's UUID.

### Constraints
- Family-scale is small (one family = ~5 users), but multiple families share the same DB
- All tenant-scoped tables have a `family_id` column (PRD §5.2)
- Auth provides family_id from JWT claim (cannot be tampered post-issuance)
- Child tokens also carry family_id, so child-scoped queries can also use this pattern

### Requirements
- Every tenant-scoped query MUST filter by `family_id` from auth context
- No code path should be able to read another family's data
- Child-end queries additionally filter by `child_id = request.auth.sub` (child can only see self)
- Tests verify cross-family access returns 404 (not 403, to avoid confirming resource existence)

## Decision

### Pattern 1: Centralized Query Builder Helper

```typescript
// src/server/db/tenant.ts
import { sql, and, eq } from 'drizzle-orm';

/**
 * Returns WHERE clause fragment enforcing tenant scope.
 * Use in EVERY tenant-scoped query.
 */
export function tenantScope(familyId: string) {
  return eq(schema.familyId, familyId);
}

/**
 * Returns WHERE clause fragment for child-scoped queries.
 * Combines family_id + child_id check.
 */
export function childScope(familyId: string, childId: string) {
  return and(
    eq(schema.familyId, familyId),
    eq(schema.childId, childId)
  );
}
```

### Pattern 2: Repository Layer with Mandatory Family ID

Every data access goes through a repository function that requires `familyId` as the first parameter. No bypass possible.

```typescript
// src/server/repositories/task-repo.ts

export const taskRepo = {
  async findById(familyId: string, taskId: string): Promise<Task | null> {
    return await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, taskId),
        eq(tasks.familyId, familyId),  // mandatory
      ),
    });
  },

  async listByFamily(familyId: string, filters: TaskFilters): Promise<Task[]> {
    return await db.query.tasks.findMany({
      where: and(
        eq(tasks.familyId, familyId),
        filters.dimensionId ? eq(tasks.dimensionId, filters.dimensionId) : undefined,
        filters.isActive !== undefined ? eq(tasks.isActive, filters.isActive) : undefined,
      ),
      orderBy: [desc(tasks.createdAt)],
    });
  },

  async create(familyId: string, input: TaskInput): Promise<Task> {
    return await db.insert(tasks).values({
      ...input,
      familyId,  // always set from auth context, never from request body
    }).returning();
  },
};
```

### Pattern 3: Fastify PreHandler Hook for Family ID Injection

```typescript
// src/server/middleware/tenant.ts

app.addHook('preHandler', async (request, reply) => {
  if (!request.auth) return;  // unauthenticated route

  // Inject familyId from auth context (never from request body/query)
  request.familyId = request.auth.family_id;

  // For child-role requests, also inject childId
  if (request.auth.role === 'child') {
    request.childId = request.auth.sub;
  }
});

// Augment Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    familyId: string;
    childId?: string;
  }
}
```

### Pattern 4: Child-Scoped Endpoints Auto-Filter

Child-accessible endpoints (e.g., `GET /api/checkins/today`) automatically filter by `request.childId`:

```typescript
app.get('/api/checkins/today', { preHandler: [requireChild] }, async (request) => {
  return await checkinRepo.listForChildOnDate(request.familyId, request.childId!, today());
});
```

### Pattern 5: Test Coverage for Cross-Family Access

```typescript
// tests/integration/cross-family-isolation.test.ts

describe('Cross-family data isolation', () => {
  let familyA: { token: string; childId: string; taskId: string };
  let familyB: { token: string; childId: string; taskId: string };

  beforeEach(async () => {
    familyA = await setupFamilyWithTask('A');
    familyB = await setupFamilyWithTask('B');
  });

  test('family A parent cannot read family B task by ID', async () => {
    const response = await request(app)
      .get(`/api/tasks/${familyB.taskId}`)
      .set('Authorization', `Bearer ${familyA.token}`);

    expect(response.status).toBe(404);  // not 403, to avoid confirming existence
  });

  test('family A child cannot check in to family B task', async () => {
    const childTokenA = await getChildToken(familyA.childId);

    const response = await request(app)
      .post('/api/checkins')
      .set('Authorization', `Bearer ${childTokenA}`)
      .send({ task_id: familyB.taskId, date: '2026-07-15' });

    expect(response.status).toBe(404);
  });

  test('family A parent cannot approve family B redemption', async () => {
    const redemptionB = await createPendingRedemption(familyB.childId, familyB.taskId);

    const response = await request(app)
      .patch(`/api/redemptions/${redemptionB}/approve`)
      .set('Authorization', `Bearer ${familyA.token}`);

    expect(response.status).toBe(404);
  });
});
```

### Pattern 6: Database-Level Defense (Optional Hardening)

For high-sensitivity tables, consider Postgres Row-Level Security (RLS) as a backstop:

```sql
-- Enable RLS on tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tasks ON tasks
  USING (family_id = current_setting('app.current_family_id', true)::uuid);

-- Application sets the variable at the start of each transaction:
-- SET LOCAL app.current_family_id = '<uuid>';
```

**MVP decision**: Skip RLS for now. Application-level enforcement with comprehensive test coverage is sufficient. Revisit if a cross-family leak is ever detected.

## Alternatives Considered

### Alternative 1: Postgres Row-Level Security (RLS)
- **Description**: DB-level enforcement; each transaction sets `app.current_family_id`
- **Pros**: Impossible to bypass at application level; defense in depth
- **Cons**: Adds complexity to every connection (must set variable); harder to test; harder to debug admin queries
- **Rejection Reason**: For MVP scale, application-level with test coverage is sufficient. RLS can be added later as hardening.

### Alternative 2: Separate database per family
- **Description**: Each family gets own Postgres database
- **Pros**: Perfect isolation; easy per-family backup/restore
- **Cons**: Connection pool exhaustion with many families; Neon free tier limits (1 project, many branches but not many DBs); operational overhead
- **Rejection Reason**: Doesn't scale beyond a few families; free tier constraints.

### Alternative 3: Separate schema per family
- **Description**: `CREATE SCHEMA family_<uuid>` per family
- **Pros**: Isolation without DB count; some DB-level enforcement possible
- **Cons**: Schema migrations multiply by N families; connection search_path complexity; ORM support tricky
- **Rejection Reason**: Operational burden; doesn't work well with Drizzle.

## Consequences

### Positive
- Single pattern (`tenantScope(familyId)`) used everywhere — easy to audit
- Repository-layer mandate prevents accidental unscoped queries
- Auth-provided `family_id` cannot be spoofed via request body
- 404 (not 403) on cross-family access prevents resource enumeration

### Negative
- Every query has an extra WHERE clause (negligible perf cost; indexed)
- Repository pattern adds a layer of indirection
- Tests must explicitly cover cross-family scenarios

### Risks
- **Risk**: Developer bypasses repository and writes raw SQL without family_id → **Mitigation**: Code review checklist; lint rule that flags raw `db.execute` without `family_id` in query
- **Risk**: JWT family_id claim is wrong (e.g., bug in token issuance) → **Mitigation**: Token issuance test verifies family_id matches user's actual family
- **Risk**: SQL injection bypasses WHERE clause → **Mitigation**: Drizzle parameterizes all queries; no string concatenation in SQL

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §4.2 | 每个孩子独立拥有：积分账户、任务进度、成长地图、成长日记、复盘记录 | All tables scoped by family_id + child_id |
| §4.2 | 家长端可切换查看不同孩子的数据 | Parent routes filter by family_id, accept child_id as query param |
| §4.2 | 孩子端仅看到自己的数据 | Child routes filter by `request.childId` from auth |
| §7.3 | 儿童信息加密存储 | Covered by ADR-0009 (data encryption); family isolation here prevents cross-family leaks |
| §7.3 | 不收集敏感个人信息 | No PII column cross-family accessible |

## Performance Implications
- **CPU**: Negligible (one extra WHERE predicate)
- **Memory**: Negligible
- **Load Time**: Indexed family_id lookup adds <1ms
- **Network**: N/A

## Migration Plan
N/A — pattern established from day 1.

## Validation Criteria
- [ ] Cross-family access test returns 404 for all 5 tenant-scoped endpoints
- [ ] Code review checklist includes "every query uses tenantScope or childScope"
- [ ] No raw `db.execute` call lacks `family_id` in WHERE clause (lint rule)
- [ ] All TDD_SPEC cross-family isolation tests pass

## Related Decisions
- ADR-0002 (Auth — provides family_id claim)
- ADR-0009 (Data Encryption — complementary defense)
