import { describe, test, expect } from 'vitest';
import { getVisibleTasks } from '@shared/domain/tasks';
import { makeTask, makeCheckIn } from '../fixtures';

describe('getVisibleTasks()', () => {
  // RED 1: 每日任务每天可见
  test('daily tasks are visible every day', () => {
    const tasks = [
      makeTask({ id: 't1', frequency: 'daily' }),
      makeTask({ id: 't2', frequency: 'weekly' }),
    ];
    const date = new Date('2026-07-15'); // Wednesday

    const visible = getVisibleTasks(tasks, 'all', date);

    expect(visible.find((t) => t.id === 't1')).toBeDefined();
  });

  // RED 2: 每周任务在周一可见
  test('weekly tasks are visible on Monday', () => {
    const tasks = [makeTask({ id: 't1', frequency: 'weekly' })];
    const monday = new Date('2026-07-13'); // Monday

    const visible = getVisibleTasks(tasks, 'all', monday);

    expect(visible).toHaveLength(1);
  });

  // RED 3: 已完成的任务不可见（传入 completedCheckins 时）
  test('completed tasks are not visible when completedCheckins provided', () => {
    const tasks = [makeTask({ id: 't1', frequency: 'daily' })];
    const completedCheckins = [makeCheckIn({ task_id: 't1', date: '2026-07-15' })];
    const date = new Date('2026-07-15');

    const visible = getVisibleTasks(tasks, 'all', date, completedCheckins);

    expect(visible).toHaveLength(0);
  });

  // RED 4: 停用任务不可见
  test('inactive tasks are not visible', () => {
    const tasks = [
      makeTask({ id: 't1', is_active: false }),
      makeTask({ id: 't2', is_active: true }),
    ];
    const date = new Date('2026-07-15');

    const visible = getVisibleTasks(tasks, 'all', date);

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('t2');
  });
});
