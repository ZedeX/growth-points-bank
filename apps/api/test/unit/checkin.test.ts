import { describe, test, expect } from 'vitest';
import { canCheckIn } from '@shared/domain/checkin';
import { makeTask, makeCheckIn } from '../fixtures';

describe('canCheckIn()', () => {
  // RED 1: 首次打卡允许
  test('allows first check-in for a task', () => {
    const result = canCheckIn([], makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(true);
  });

  // RED 2: 同日重复打卡拒绝
  test('rejects duplicate check-in same day', () => {
    const existing = [makeCheckIn({ task_id: 't1', date: '2026-07-15' })];
    const result = canCheckIn(existing, makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('already');
  });

  // RED 3: 已被家长撤销的打卡可重新打卡
  test('allows re-check-in after parent revocation', () => {
    const existing = [makeCheckIn({ task_id: 't1', date: '2026-07-15', revoked_by_parent: true })];
    const result = canCheckIn(existing, makeTask({ id: 't1', frequency: 'daily' }), new Date('2026-07-15'));
    expect(result.ok).toBe(true);
  });
});
