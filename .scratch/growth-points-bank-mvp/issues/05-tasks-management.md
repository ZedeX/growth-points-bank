# 05 — Tasks Management

**What to build:** A parent can create, list, update, soft-delete, and toggle active/inactive status on tasks tied to one of the 5 growth dimensions. Children can list currently-visible tasks (filtered by frequency rule + active state). After this ticket, a parent can fully configure their family's task library, and a child can fetch their "today's task list" reflecting daily/weekly/once visibility rules.

**Blocked by:** 04 — Family and Children CRUD.

**Status:** ready-for-agent

- [ ] `src/shared/domain/tasks.ts` pure functions: `getVisibleTasks(tasks, frequency, date, completedCheckins)`, `isTaskVisibleOn(task, date)`, `isPastDate`, `isFutureDate`, `isSameDay`
- [ ] `src/server/routes/tasks.ts`: `POST /api/tasks`, `GET /api/tasks` (parent sees all; child sees visible today), `PUT /api/tasks/:id`, `DELETE /api/tasks/:id` (soft delete via `is_active=false`), `PATCH /api/tasks/:id/toggle`
- [ ] `src/shared/schemas/task.ts` Zod: title (1-30), dimension_id (1-5), point_value (1-20), frequency enum, description optional (max 200)
- [ ] Frequency rules per PRD §3.2: daily → always visible, weekly → only Monday, once → visible until completed
- [ ] Task repository enforces `family_id` filter on all queries
- [ ] All tests from `TDD_SPEC.md §5` pass (create daily task, point_value boundary 20/21, invalid dimension, empty title)
- [ ] All tests from `TDD_SPEC.md §5.2` pass (daily visible, weekly Monday-only, once completed hidden, inactive hidden)
- [ ] `src/shared/domain/tasks.ts` unit tests: 4 cases per `TDD_SPEC.md §5.2` RED 1-4
- [ ] Endpoint tests: `GET /api/tasks` as parent returns all family tasks; as child returns only visible-today tasks
- [ ] Soft delete preserves existing checkin records (no cascade delete)
