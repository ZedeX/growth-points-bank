import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  registerParent,
  createTestApp,
  cleanDatabase,
  createChild,
  getChildJwt,
  createTask,
} from './helpers';

let app: FastifyInstance;
let parentToken: string;
let childToken: string;
let childId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDatabase();
  const reg = await registerParent({ email: 'reviews-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '复盘孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

describe('POST /api/reviews/child', () => {
  // RED 1: child submits review section
  test('child submits own review section', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '我学会了游泳',
        difficulty: '早起很难',
        child_request: '想多吃一次冰淇淋',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('submitted');
    expect(response.json().locked).toBe(false);
  });

  // RED 2: rejects submission when review is locked
  test('rejects submission when review is locked', async () => {
    // Both submit to trigger lock
    await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '第一版',
        difficulty: '...',
        child_request: '...',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/reviews/parent',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '看到孩子的努力',
      },
    });

    // Now locked, child tries to submit again
    const response = await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '试图修改',
        difficulty: '...',
        child_request: '...',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(6001);
  });

  // RED 3: auto-locks when both child and parent have committed
  test('auto-locks when both child and parent have committed', async () => {
    // Child submits first
    await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '我的进步',
        difficulty: '...',
        child_request: '...',
      },
    });

    // Parent submits → triggers lock
    const response = await app.inject({
      method: 'POST',
      url: '/api/reviews/parent',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '看到孩子的努力',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().locked).toBe(true);
  });

  // RED 4: upserts review for same week
  test('upserts review for same week', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '第一版',
        difficulty: '...',
        child_request: '...',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '修改版',
        difficulty: '...',
        child_request: '...',
      },
    });

    expect(response.statusCode).toBe(200);

    // Verify only one review exists with updated content
    const getResp = await app.inject({
      method: 'GET',
      url: '/api/reviews?week_start_date=2026-07-13',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(getResp.json().review.best_thing).toBe('修改版');
  });
});

describe('GET /api/reviews', () => {
  // RED 5: parent observation becomes visible to child after lock
  test('parent observation visible to child after both committed', async () => {
    // Child submits
    await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '我的进步',
        difficulty: '...',
        child_request: '...',
      },
    });

    // Parent submits → triggers lock
    await app.inject({
      method: 'POST',
      url: '/api/reviews/parent',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '私密观察',
      },
    });

    // Child reads
    const response = await app.inject({
      method: 'GET',
      url: '/api/reviews?week_start_date=2026-07-13',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().review.locked).toBe(true);
    // After lock, other's content is visible
    expect(response.json().review.other.parent_observation).toBe('私密观察');
  });

  // RED 6: computes task_count, point_earned, dimension_count on lock
  test('computes aggregation stats on lock', async () => {
    // Seed activity: create tasks and check in
    const task1 = await createTask(app, parentToken, {
      title: '阅读',
      point_value: 3,
      dimension_code: 'learning',
      age_group: '6-8',
    });
    const task2 = await createTask(app, parentToken, {
      title: '运动',
      point_value: 2,
      dimension_code: 'sports',
      age_group: '6-8',
    });

    // Check in within the week of 2026-07-13
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task1, date: '2026-07-14' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task2, date: '2026-07-15' },
    });

    // Both submit to trigger lock + aggregation
    await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: '...',
        difficulty: '...',
        child_request: '...',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/reviews/parent',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: '...',
      },
    });

    // Read review
    const response = await app.inject({
      method: 'GET',
      url: '/api/reviews?week_start_date=2026-07-13',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().review.task_count).toBe(2);
    expect(response.json().review.point_earned).toBe(5); // 3 + 2
    expect(response.json().review.dimension_count).toBe(2); // learning + sports
  });
});
