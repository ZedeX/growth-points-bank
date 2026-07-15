# ADR-0007: Frontend State Management (TanStack Query + Zustand)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | React 18 + TanStack Query v5 + Zustand 4 |
| Domain | Frontend State / Data Fetching |
| Knowledge Risk | LOW — both libraries are mature |
| References Consulted | PRD §6 (页面规格) |
| Post-Cutoff APIs Used | None |
| Verification Required | None |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack) |
| Enables | All frontend work |
| Blocks | Epic "Frontend Components" |
| Ordering Note | Set up providers before any component tests |

## Context

### Problem Statement
Frontend state in this app falls into two distinct categories with different needs:

1. **Server state** (most of the app): tasks, check-ins, points, redemptions, reviews, diaries — all fetched from API, needs caching, invalidation, optimistic updates, retry, error handling
2. **UI state** (small): which dimension filter is selected, modal open/closed, current selected child (for parent view), theme preference — ephemeral, no server source

Mixing these into a single state store (e.g., Redux with thunks) creates boilerplate and obscures the boundary. Using TanStack Query for server state and Zustand for UI state keeps each concern clean.

### Constraints
- Mobile-first — minimize JS bundle size
- Offline-capable (Phase 2): need optimistic updates that survive short disconnections
- Real-time feedback on check-in (PRD §3.2: 积分实时入账)
- Filter state in URL (shareable links)

### Requirements
- Check-in mutation optimistically updates UI, rolls back on failure
- Points balance refreshes after check-in without full reload
- Parent switching between children should be instant (cached)
- Filter state (`?dimension=1&date=today`) in URL for shareable links
- All async state tracked (loading, error, success) without manual `useEffect` + `useState` chains

## Decision

### Server State: TanStack Query v5

```typescript
// src/client/queries/checkins.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export const checkinKeys = {
  all: ['checkins'] as const,
  today: (childId: string) => ['checkins', 'today', childId] as const,
  list: (childId: string, date: string) => ['checkins', 'list', childId, date] as const,
};

export function useTodayCheckins(childId: string) {
  return useQuery({
    queryKey: checkinKeys.today(childId),
    queryFn: () => api.getTodayCheckins(childId),
    staleTime: 30_000,  // 30 seconds — fresh enough for "today" view
  });
}

export function useCheckInMutation(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; date: string }) => api.checkIn(input),

    // Optimistic update: show as checked-in immediately
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: checkinKeys.today(childId) });
      const previous = qc.getQueryData(checkinKeys.today(childId));

      qc.setQueryData<CheckIn[]>(checkinKeys.today(childId), (old = []) => [
        ...old,
        { task_id: input.taskId, date: input.date, _optimistic: true },
      ]);

      return { previous };
    },

    onError: (_err, _input, context) => {
      // Rollback on failure
      qc.setQueryData(checkinKeys.today(childId), context?.previous);
    },

    onSettled: () => {
      // Refetch to get authoritative state
      qc.invalidateQueries({ queryKey: checkinKeys.today(childId) });
      qc.invalidateQueries({ queryKey: ['points', 'balance', childId] });  // refresh balance
    },
  });
}
```

### UI State: Zustand

```typescript
// src/client/stores/ui-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  // Dimension filter on check-in page
  selectedDimension: number | null;
  setSelectedDimension: (d: number | null) => void;

  // Parent view: which child is currently selected
  selectedChildId: string | null;
  setSelectedChild: (id: string | null) => void;

  // Theme (defer to Phase 2)
  // theme: 'light' | 'dark';

  // Reward redemption modal
  redemptionModalOpen: boolean;
  redemptionModalRewardId: string | null;
  openRedemptionModal: (rewardId: string) => void;
  closeRedemptionModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedDimension: null,
      setSelectedDimension: (d) => set({ selectedDimension: d }),

      selectedChildId: null,
      setSelectedChild: (id) => set({ selectedChildId: id }),

      redemptionModalOpen: false,
      redemptionModalRewardId: null,
      openRedemptionModal: (rewardId) =>
        set({ redemptionModalOpen: true, redemptionModalRewardId: rewardId }),
      closeRedemptionModal: () =>
        set({ redemptionModalOpen: false, redemptionModalRewardId: null }),
    }),
    {
      name: 'gpb-ui-store',
      // Only persist selectedChildId (parent's last-viewed child); filter state lives in URL
      partialize: (state) => ({ selectedChildId: state.selectedChildId }),
    }
  )
);
```

### URL State: React Router Search Params

```typescript
// src/client/pages/CheckInPage.tsx
import { useSearchParams } from 'react-router-dom';

function CheckInPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dimensionFilter = searchParams.get('dimension') ?? 'all';
  const date = searchParams.get('date') ?? today();

  const setDimensionFilter = (d: string) => {
    setSearchParams(prev => {
      prev.set('dimension', d);
      return prev;
    });
  };

  // ... render
}
```

### Provider Setup

```typescript
// src/client/main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,  // 1 min default
      refetchOnWindowFocus: false,  // no refetch on window focus (mobile-focused)
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);
```

## Alternatives Considered

### Alternative 1: Redux Toolkit (RTK) + RTK Query
- **Description**: Single store for everything; RTK Query for server state
- **Pros**: Unified mental model; large ecosystem
- **Cons**: Bundle size (~12kb gzipped vs ~3kb for Zustand); more boilerplate for UI state; RTK Query less flexible than TanStack Query for optimistic updates
- **Rejection Reason**: TanStack Query is more focused; Zustand handles UI state with less ceremony. Bundle size matters for mobile.

### Alternative 2: Single Zustand store with manual fetch logic
- **Description**: Use Zustand for everything, write custom fetch hooks
- **Pros**: Single dependency; full control
- **Cons**: Reinventing TanStack Query (caching, invalidation, retry, devtools); significant code; harder to test
- **Rejection Reason**: Don't reinvent the wheel. TanStack Query is purpose-built for server state.

### Alternative 3: Jotai / Recoil (atomic state)
- **Description**: Atomic state model; fine-grained subscriptions
- **Pros**: Excellent for derived state; minimal re-renders
- **Cons**: Different mental model; less suited for server state (would still need TanStack Query); ecosystem smaller
- **Rejection Reason**: Atomic model is overkill for this app's simple UI state.

## Consequences

### Positive
- Clear separation: server state in TanStack Query, UI state in Zustand, URL state in router
- Optimistic updates built-in to mutations
- Cache invalidation is declarative (`invalidateQueries`)
- Zustand store is ~1KB gzipped; TanStack Query ~13KB gzipped; total smaller than Redux Toolkit
- Mobile-friendly bundle size

### Negative
- Two libraries to learn (slight curve)
- DevTools split between React Query Devtools and Zustand devtools
- Cache invalidation requires discipline (forgetting to invalidate = stale UI)

### Risks
- **Risk**: Stale cache after parent updates task (e.g., changes point_value) → **Mitigation**: Mutation `onSettled` invalidates `['tasks']` and `['checkins', 'today']`
- **Risk**: Optimistic update fails silently → **Mitigation**: `onError` rolls back; UI shows toast on failure
- **Risk**: Zustand persist loses selectedChildId if cleared → **Mitigation**: Page-level fallback: if no selectedChildId, redirect to /parent (child selector)

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §3.2 | 积分实时入账 → 积分数字动画上升 | Optimistic update + balance invalidation |
| §3.2 | 已完成任务可点击取消勾选 → 扣除已得积分 | Mutation with rollback on failure |
| §3.2 | 筛选标签点击 → 仅显示该维度的任务 | URL state `?dimension=1` |
| §4.2 | 家长端可切换查看不同孩子的数据 | Zustand `selectedChildId`, persisted |
| §6.1 | 页面流转 | React Router with URL state |

## Performance Implications
- **CPU**: TanStack Query cache lookups are O(1) hash map; negligible
- **Memory**: Cache holds ~10 queries × ~5KB each = ~50KB; trivial
- **Load Time**: Bundle: React 18 (~45KB) + React Query (~13KB) + Zustand (~1KB) + router (~10KB) = ~70KB gzipped initial
- **Network**: Smart refetch (stale-while-revalidate) reduces redundant requests

## Migration Plan
N/A — new codebase.

## Validation Criteria
- [ ] Check-in mutation optimistically updates UI within 16ms (one frame)
- [ ] Rollback works on API failure (test: mock 500 response)
- [ ] Filter state survives page reload (via URL)
- [ ] Parent's selectedChildId persists across reloads (via Zustand persist)
- [ ] No `useEffect` + `useState` chains for server state (lint rule)
- [ ] All TDD_SPEC §9 component tests pass

## Related Decisions
- ADR-0001 (Tech Stack — provides React + Vite foundation)
