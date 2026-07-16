// Test data factories (fixtures) for unit and integration tests.
// Based on TDD_SPEC.md §10 fixtures, adapted to the actual schema.

import type {
  DomainTask,
  DomainCheckIn,
  DomainReward,
  DomainRedemption,
  DomainDimension,
} from '@shared/domain/types';

export function makeTask(overrides: Partial<DomainTask> = {}): DomainTask {
  return {
    id: 'task-1',
    family_id: 'fam-1',
    dimension_id: 1,
    title: '阅读30分钟',
    point_value: 2,
    frequency: 'daily',
    is_active: true,
    ...overrides,
  };
}

export function makeCheckIn(overrides: Partial<DomainCheckIn> = {}): DomainCheckIn {
  return {
    id: 'checkin-1',
    child_id: 'child-1',
    task_id: 'task-1',
    date: '2026-07-15',
    revoked_by_parent: false,
    revoked_at: null,
    ...overrides,
  };
}

export function makeReward(overrides: Partial<DomainReward> = {}): DomainReward {
  return {
    id: 'reward-1',
    family_id: 'fam-1',
    title: '家庭电影',
    point_cost: 10,
    total_inventory: 999,
    total_claimed: 0,
    weekly_limit_per_child: 1,
    is_active: true,
    ...overrides,
  };
}

export function makeRedemption(overrides: Partial<DomainRedemption> = {}): DomainRedemption {
  return {
    id: 'redemption-1',
    child_id: 'child-1',
    reward_id: 'reward-1',
    point_cost: 10,
    status: 'pending',
    ...overrides,
  };
}

export function makeDimension(overrides: Partial<DomainDimension> = {}): DomainDimension {
  return {
    id: 1,
    family_id: null,
    code: 'learning',
    name: '学习力',
    color: '#2196F3',
    sort_order: 1,
    ...overrides,
  };
}

export const mockDimensions: DomainDimension[] = [
  { id: 1, family_id: null, code: 'learning', name: '学习力', color: '#2196F3', sort_order: 1 },
  { id: 2, family_id: null, code: 'sports', name: '运动力', color: '#FF9800', sort_order: 2 },
  { id: 3, family_id: null, code: 'self_control', name: '自控力', color: '#9C27B0', sort_order: 3 },
  { id: 4, family_id: null, code: 'exploration', name: '探索力', color: '#4CAF50', sort_order: 4 },
  { id: 5, family_id: null, code: 'practice', name: '实践力', color: '#F44336', sort_order: 5 },
];

export function makeReview(overrides: Partial<{
  id: string;
  child_id: string;
  week_start_date: string;
  best_thing: string | null;
  difficulty: string | null;
  child_request: string | null;
  child_committed_at: string | null;
  parent_observation: string | null;
  parent_committed_at: string | null;
  locked_at: string | null;
}> = {}) {
  return {
    id: 'review-1',
    child_id: 'child-1',
    week_start_date: '2026-07-13',
    best_thing: '我的进步',
    difficulty: '有点难',
    child_request: '希望多点阅读时间',
    child_committed_at: null,
    parent_observation: '家长的看见',
    parent_committed_at: null,
    locked_at: null,
    ...overrides,
  };
}
