import { describe, test, expect } from 'vitest';
import { canRedeem } from '@shared/domain/points';
import { makeReward } from '../fixtures';

describe('canRedeem()', () => {
  // RED 1: 积分充足可以兑换
  test('allows redemption when balance is sufficient', () => {
    const result = canRedeem(50, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(true);
  });

  // RED 2: 积分不足不可兑换
  test('rejects redemption when balance is insufficient', () => {
    const result = canRedeem(10, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(false);
    expect(result.shortfall).toBe(20);
  });

  // RED 3: 积分恰好等于兑换值
  test('allows redemption when balance equals cost', () => {
    const result = canRedeem(30, makeReward({ point_cost: 30 }));
    expect(result.ok).toBe(true);
  });
});
