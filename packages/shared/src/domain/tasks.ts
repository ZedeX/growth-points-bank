import type { DomainTask, DomainCheckIn, DimensionStatus } from './types.js';

/**
 * Filter tasks that are visible on a given date.
 *
 * - Inactive tasks are hidden.
 * - Weekly tasks are visible only on Mondays.
 * - Daily tasks are visible every day.
 *
 * Note: "once" frequency tasks that are completed are hidden if completedCheckins is provided.
 */
export function getVisibleTasks(
  tasks: DomainTask[],
  ageGroup: string | 'all',
  date: Date,
  completedCheckins?: DomainCheckIn[],
): DomainTask[] {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday
  const isMonday = dayOfWeek === 1;
  const dateStr = date.toISOString().slice(0, 10);

  const completedTaskIds = new Set(
    (completedCheckins ?? [])
      .filter((c) => c.date === dateStr && !c.revoked_by_parent)
      .map((c) => c.task_id),
  );

  return tasks.filter((task) => {
    if (!task.is_active) return false;
    if (ageGroup !== 'all' && task.age_group && task.age_group !== ageGroup) return false;

    if (task.frequency === 'weekly' && !isMonday) return false;

    // "once" tasks that are already completed today are hidden
    // Since our schema only has 'daily' and 'weekly', this is handled via completedCheckins
    if (completedTaskIds.has(task.id)) return false;

    return true;
  });
}

/**
 * Calculate the completion status of a dimension for a given date.
 *
 * - "none": no tasks in this dimension have valid check-ins today
 * - "partial": some but not all tasks have check-ins
 * - "complete": all tasks in this dimension have valid check-ins
 *
 * Revoked check-ins and check-ins from other dates are excluded.
 */
export function getDimensionStatus(
  dimensionId: number | string,
  checkins: DomainCheckIn[],
  tasks: DomainTask[],
  date: Date,
): DimensionStatus {
  const dateStr = date.toISOString().slice(0, 10);

  const dimensionTasks = tasks.filter((t) => t.dimension_id === dimensionId && t.is_active);
  if (dimensionTasks.length === 0) return 'none';

  const validCheckinTaskIds = new Set(
    checkins
      .filter((c) => !c.revoked_by_parent && c.date === dateStr)
      .map((c) => c.task_id),
  );

  const completedCount = dimensionTasks.filter((t) => validCheckinTaskIds.has(t.id)).length;

  if (completedCount === 0) return 'none';
  if (completedCount < dimensionTasks.length) return 'partial';
  return 'complete';
}
