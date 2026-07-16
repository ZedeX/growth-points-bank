import type { DomainDimension, DomainCheckIn, DomainTask } from './types.js';

export interface DomainReview {
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
}

export interface VisibleReview {
  best_thing: string | null;
  difficulty: string | null;
  child_request: string | null;
  parent_observation: string | null;
  other_status: 'other_not_started' | 'other_committed' | 'locked';
  locked: boolean;
}

/**
 * Get the visible fields of a weekly review based on the double-blind mechanism.
 *
 * Rules (ADR-0005):
 * - If locked (both committed): all fields visible to both parties.
 * - If other party hasn't committed: their fields are hidden.
 * - If other party has committed: their fields become visible.
 */
export function getReviewVisibility(
  review: DomainReview,
  viewerRole: 'child' | 'parent',
): VisibleReview {
  // If locked, everything is visible
  if (review.locked_at) {
    return {
      best_thing: review.best_thing,
      difficulty: review.difficulty,
      child_request: review.child_request,
      parent_observation: review.parent_observation,
      other_status: 'locked',
      locked: true,
    };
  }

  const otherCommitted =
    viewerRole === 'child'
      ? review.parent_committed_at !== null
      : review.child_committed_at !== null;

  const otherStatus = otherCommitted ? 'other_committed' : 'other_not_started';

  if (viewerRole === 'child') {
    return {
      best_thing: review.best_thing,
      difficulty: review.difficulty,
      child_request: review.child_request,
      parent_observation: otherCommitted ? review.parent_observation : null,
      other_status: otherStatus,
      locked: false,
    };
  }

  // viewerRole === 'parent'
  return {
    best_thing: otherCommitted ? review.best_thing : null,
    difficulty: otherCommitted ? review.difficulty : null,
    child_request: otherCommitted ? review.child_request : null,
    parent_observation: review.parent_observation,
    other_status: otherStatus,
    locked: false,
  };
}

/**
 * Calculate dimension summary for a week.
 */
export function getDimensionSummary(
  dimensions: DomainDimension[],
  checkins: DomainCheckIn[],
  tasks: DomainTask[],
): Array<{ dimension: DomainDimension; checkinCount: number; pointsEarned: number }> {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return dimensions
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((dimension) => {
      const dimensionTaskIds = new Set(
        tasks.filter((t) => t.dimension_id === dimension.id).map((t) => t.id),
      );
      const dimensionCheckins = checkins.filter((c) => dimensionTaskIds.has(c.task_id) && !c.revoked_by_parent);
      const pointsEarned = dimensionCheckins.reduce(
        (sum, c) => sum + (taskMap.get(c.task_id)?.point_value ?? 0),
        0,
      );
      return {
        dimension,
        checkinCount: dimensionCheckins.length,
        pointsEarned,
      };
    });
}
