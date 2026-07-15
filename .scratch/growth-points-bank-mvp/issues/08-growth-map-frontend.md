# 08 — Growth Map and Check-In Frontend

**What to build:** The child-facing home page (`/`) showing the 5-dimension growth map with progress indicators, plus the daily check-in page (`/checkin`) with category filters and task cards. Tapping a task marks it complete with a points animation. The growth map reflects today's checkins in real-time. After this ticket, a child can land on the app, see their map, tap into today's tasks, check off items, and watch points accumulate.

**Blocked by:** 06 — Daily Check-In and Points Ledger (APIs must exist first).

**Status:** ready-for-agent

- [ ] React Router setup: `/` (GrowthMap), `/checkin` (CheckInPage), `/rewards` (RewardsPage stub), `/reviews` (WeeklyReviewPage stub), `/diaries` (DiaryListPage stub)
- [ ] TanStack Query client with `staleTime: 30s` for checkins, `0s` for balance (real-time)
- [ ] Zustand `authStore` with persist middleware for token + role
- [ ] `<GrowthMap>` component: 5 dimension cards in vertical list with progress (`none`/`partial`/`complete`), taps to expand task list
- [ ] `<TaskCard>` component: title, dimension color tag, point value, completion checkbox, grayed-out when complete
- [ ] `<CheckInPage>`: top filter tabs (All/学习力/运动力/自控力/探索力/实践力), task list, bottom stats bar ("今日完成 X 项，获得 Y 分")
- [ ] `<PointsBalance>` component with floating "+2" animation on check-in
- [ ] Optimistic update on check-in mutation (TanStack Query `onMutate` + `onError` rollback)
- [ ] Invalidates `['checkins', 'today']` and `['points', 'balance']` after successful check-in
- [ ] Mobile-first responsive layout (max-width 480px on phone, fluid on tablet/desktop)
- [ ] All component tests from `TDD_SPEC.md §9` pass (GrowthMap renders 5 cards, TaskCard interaction, CheckInPage filtering)
- [ ] All component tests from existing TDD_SPEC §6.x component tests pass
- [ ] E2E test `daily-flow.spec.ts` from `TDD_SPEC.md §12` passes: child logs in → sees map → opens check-in → completes task → sees points update → returns to map → dimension partial-lit
- [ ] Lighthouse mobile score ≥ 90 for performance, accessibility, best practices
