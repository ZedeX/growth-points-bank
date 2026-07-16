import type {
  DomainCheckIn,
  DomainTask,
  DomainRedemption,
  DomainReward,
  RedemptionCheckResult,
} from './types.js';

/**
 * Calculate total points for a child from check-ins minus fulfilled redemptions.
 *
 * - Revoked check-ins are excluded.
 * - Only fulfilled or approved redemptions are subtracted (pending ones don't deduct yet).
 */
export function calculatePoints(
  checkins: DomainCheckIn[],
  tasks: DomainTask[],
  redemptions: DomainRedemption[] = [],
): number {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const earned = checkins
    .filter((c) => !c.revoked_by_parent)
    .filter((c) => taskMap.has(c.task_id))
    .reduce((sum, c) => sum + (taskMap.get(c.task_id)?.point_value ?? 0), 0);

  const spent = redemptions
    .filter((r) => r.status === 'fulfilled')
    .reduce((sum, r) => sum + r.point_cost, 0);

  return earned - spent;
}

/**
 * Check if a child can redeem a reward given their current balance.
 * Returns { ok: true } if balance is sufficient, or { ok: false, shortfall } if not.
 */
export function canRedeem(
  balance: number,
  reward: Pick<DomainReward, 'point_cost'>,
): RedemptionCheckResult {
  if (balance >= reward.point_cost) {
    return { ok: true };
  }
  return { ok: false, shortfall: reward.point_cost - balance };
}
