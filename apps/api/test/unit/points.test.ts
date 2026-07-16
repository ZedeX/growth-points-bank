import { describe, test, expect } from 'vitest';
import { calculatePoints } from '@shared/domain/points';
import { makeTask, makeCheckIn, makeRedemption } from '../fixtures';

describe('calculatePoints()', () => {
  // RED 1: 无打卡积分为0
  test('returns 0 when no check-ins', () => {
    const result = calculatePoints([], []);
    expect(result).toBe(0);
  });

  // RED 2: 单个打卡的积分
  test('returns correct points for single check-in', () => {
    const tasks = [makeTask({ id: 't1', point_value: 3 })];
    const checkins = [makeCheckIn({ task_id: 't1' })];
    expect(calculatePoints(checkins, tasks)).toBe(3);
  });

  // RED 3: 多个打卡的积分累加
  test('sums points across multiple check-ins', () => {
    const tasks = [
      makeTask({ id: 't1', point_value: 2 }),
      makeTask({ id: 't2', point_value: 5 }),
    ];
    const checkins = [
      makeCheckIn({ task_id: 't1' }),
      makeCheckIn({ task_id: 't2' }),
    ];
    expect(calculatePoints(checkins, tasks)).toBe(7);
  });

  // RED 4: 被家长撤销的打卡不计分
  test('excludes revoked check-ins', () => {
    const tasks = [makeTask({ id: 't1', point_value: 2 })];
    const checkins = [
      makeCheckIn({ task_id: 't1', revoked_by_parent: true }),
    ];
    expect(calculatePoints(checkins, tasks)).toBe(0);
  });

  // RED 5: 扣除已兑换积分
  test('subtracts redeemed points from total', () => {
    const tasks = [makeTask({ id: 't1', point_value: 10 })];
    const checkins = [makeCheckIn({ task_id: 't1' })];
    const redemptions = [makeRedemption({ point_cost: 3, status: 'fulfilled' })];
    expect(calculatePoints(checkins, tasks, redemptions)).toBe(7);
  });
});
