import { describe, test, expect } from 'vitest';
import { getDimensionStatus } from '@shared/domain/tasks';
import { makeTask, makeCheckIn } from '../fixtures';

describe('getDimensionStatus()', () => {
  const tasks = [
    makeTask({ id: 't1', dimension_id: 1, frequency: 'daily' }),
    makeTask({ id: 't2', dimension_id: 1, frequency: 'daily' }),
  ];

  // RED 1: 无打卡 → none
  test('returns "none" when no check-ins', () => {
    const status = getDimensionStatus(1, [], tasks, new Date('2026-07-15'));
    expect(status).toBe('none');
  });

  // RED 2: 部分打卡 → partial
  test('returns "partial" when some tasks are completed', () => {
    const checkins = [makeCheckIn({ task_id: 't1', date: '2026-07-15' })];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('partial');
  });

  // RED 3: 全部打卡 → complete
  test('returns "complete" when all tasks are completed', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-15' }),
      makeCheckIn({ task_id: 't2', date: '2026-07-15' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('complete');
  });

  // RED 4: 被撤销的打卡不计入
  test('excludes revoked check-ins from status', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-15', revoked_by_parent: true }),
      makeCheckIn({ task_id: 't2', date: '2026-07-15' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('partial');
  });

  // RED 5: 其他日期的打卡不计入
  test('excludes check-ins from other dates', () => {
    const checkins = [
      makeCheckIn({ task_id: 't1', date: '2026-07-14' }),
      makeCheckIn({ task_id: 't2', date: '2026-07-14' }),
    ];
    const status = getDimensionStatus(1, checkins, tasks, new Date('2026-07-15'));
    expect(status).toBe('none');
  });
});
