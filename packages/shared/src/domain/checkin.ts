import type { DomainCheckIn, DomainTask } from './types.js';

export interface CheckInCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Check if a child can check in for a task on a given date.
 *
 * Rules:
 * - First check-in for a task on a given date is allowed.
 * - Duplicate check-in on the same date is rejected.
 * - If the previous check-in was revoked by parent, a new check-in is allowed.
 */
export function canCheckIn(
  existingCheckins: DomainCheckIn[],
  task: DomainTask,
  date: Date,
): CheckInCheckResult {
  const dateStr = date.toISOString().slice(0, 10);

  const sameDayCheckins = existingCheckins.filter(
    (c) => c.task_id === task.id && c.date === dateStr,
  );

  const hasActiveCheckin = sameDayCheckins.some((c) => !c.revoked_by_parent);

  if (hasActiveCheckin) {
    return { ok: false, reason: 'already_checked_in_today' };
  }

  return { ok: true };
}
