import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  registerParent,
  createTestApp,
  cleanDatabase,
  createChild,
  getChildJwt,
  createTask,
  createReward,
} from './helpers';

let app: FastifyInstance;
let parentToken: string;
let childToken: string;
let childId: string;

beforeEach(async () => {
  await cleanDatabase();
  app = await createTestApp();
  const reg = await registerParent({ email: 'concurrency-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '并发孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

afterEach(async () => {
  await app.close();
});

describe('SERIALIZABLE retry on point transactions', () => {
  // RED 1: concurrent checkins on different tasks produce correct balance
  test('concurrent checkins on different tasks produce correct balance', async () => {
    const task1 = await createTask(app, parentToken, { title: '任务A', point_value: 2, age_group: '6-8' });
    const task2 = await createTask(app, parentToken, { title: '任务B', point_value: 2, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    // Fire both checkins concurrently
    await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { task_id: task1, date: today },
      }),
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { task_id: task2, date: today },
      }),
    ]);

    // Verify balance
    const balanceResp = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(balanceResp.json().balance).toBe(4); // 2 + 2, no lost updates
  });

  // RED 2: concurrent checkins on same task result in only one record
  test('concurrent checkins on same task result in only one record', async () => {
    const task = await createTask(app, parentToken, { title: '独占任务', point_value: 3, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    const results = await Promise.allSettled([
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { task_id: task, date: today },
      }),
      app.inject({
        method: 'POST',
        url: '/api/checkins',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { task_id: task, date: today },
      }),
    ]);

    // Exactly one should succeed (201), the other should fail (409 conflict)
    const successes = results.filter(
      r => r.status === 'fulfilled' && r.value.statusCode === 201
    );
    expect(successes).toHaveLength(1);

    // Balance should only reflect one checkin
    const balanceResp = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(balanceResp.json().balance).toBe(3); // only +3, no duplicate
  });
});

describe('Concurrent redemption creation', () => {
  // RED 3: balance covers only one redemption; concurrent creation only succeeds once
  test('concurrent redemptions when balance covers only one succeed once', async () => {
    // Award 30 points
    const taskId = await createTask(app, parentToken, { title: '赚钱任务', point_value: 30, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    // Create two rewards costing 30 each
    const reward1 = await createReward(app, parentToken, { point_cost: 30 });
    const reward2 = await createReward(app, parentToken, { point_cost: 30 });

    // Fire both redemptions concurrently
    const results = await Promise.allSettled([
      app.inject({
        method: 'POST',
        url: '/api/redemptions',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { reward_id: reward1 },
      }),
      app.inject({
        method: 'POST',
        url: '/api/redemptions',
        headers: { authorization: `Bearer ${childToken}` },
        payload: { reward_id: reward2 },
      }),
    ]);

    // Exactly one should succeed (201), the other should fail (400 insufficient points)
    const successes = results.filter(
      r => r.status === 'fulfilled' && r.value.statusCode === 201
    );
    const failures = results.filter(
      r => r.status === 'fulfilled' && r.value.statusCode === 400
    );
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].value.json().error.code).toBe(3001); // INSUFFICIENT_BALANCE
  });
});

describe('Idempotency of checkin unique constraint', () => {
  // RED 4: duplicate checkin returns 409, not 500
  test('duplicate checkin returns 409 conflict, not 500', async () => {
    const task = await createTask(app, parentToken, { title: '重复任务', point_value: 1, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    // First checkin
    const first = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task, date: today },
    });
    expect(first.statusCode).toBe(201);

    // Second checkin (sequential, not concurrent)
    const second = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task, date: today },
    });
    expect(second.statusCode).toBe(409);
  });

  // RED 5: concurrent parent + child review submission triggers lock exactly once
  test('sequential review submissions trigger lock on second commit', async () => {
    // Child submits first
    const childResp = await app.inject({
      method: 'POST',
      url: '/api/reviews/child',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        week_start_date: '2026-07-13',
        best_thing: 'child content',
        difficulty: '...',
        child_request: '...',
      },
    });
    expect(childResp.json().locked).toBe(false);

    // Parent submits → triggers lock
    const parentResp = await app.inject({
      method: 'POST',
      url: '/api/reviews/parent',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        child_id: childId,
        week_start_date: '2026-07-13',
        parent_observation: 'parent content',
      },
    });
    expect(parentResp.json().locked).toBe(true);

    // Verify review is locked
    const getResp = await app.inject({
      method: 'GET',
      url: '/api/reviews?week_start_date=2026-07-13',
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(getResp.json().review.locked).toBe(true);
  });
});
