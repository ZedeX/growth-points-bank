import { describe, test, expect } from 'vitest';
import { getReviewVisibility } from '@shared/domain/reviews';
import { makeReview } from '../fixtures';

describe('getReviewVisibility()', () => {
  // RED 1: 双方都未提交，仅看到自己区域
  test('returns own content and hides other when neither committed', () => {
    const review = makeReview({
      best_thing: '我的进步',
      parent_observation: '家长的看见',
      child_committed_at: null,
      parent_committed_at: null,
    });
    const viewerRole = 'child' as const;

    const visible = getReviewVisibility(review, viewerRole);

    expect(visible.best_thing).toBe('我的进步');
    expect(visible.parent_observation).toBeNull();
    expect(visible.other_status).toBe('other_not_started');
  });

  // RED 2: 对方已提交，自己可见
  test('shows other content when other has committed', () => {
    const review = makeReview({
      best_thing: '我的进步',
      parent_observation: '家长的看见',
      child_committed_at: null,
      parent_committed_at: new Date('2026-07-13').toISOString(),
    });
    const viewerRole = 'child' as const;

    const visible = getReviewVisibility(review, viewerRole);

    expect(visible.parent_observation).toBe('家长的看见');
    expect(visible.other_status).toBe('other_committed');
  });

  // RED 3: 双方都提交后 locked
  test('returns locked=true when both committed', () => {
    const review = makeReview({
      child_committed_at: new Date('2026-07-13T10:00:00Z').toISOString(),
      parent_committed_at: new Date('2026-07-13T15:00:00Z').toISOString(),
      locked_at: new Date('2026-07-13T15:00:00Z').toISOString(),
    });

    const visible = getReviewVisibility(review, 'child');

    expect(visible.locked).toBe(true);
  });
});
