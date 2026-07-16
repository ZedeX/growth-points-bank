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
  const reg = await registerParent({ email: 'errors-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '边界孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

afterEach(async () => {
  await app.close();
});

describe('Input validation edge cases', () => {
  // RED 1: task point_value boundary: 1 accepted, 100 accepted, 0 and 101 rejected
  test('point_value boundary: 1 and 100 accepted, 0 and 101 rejected', async () => {
    // Get a valid dimension_id
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${parentToken}` },
    });
    const dim = dimsResp.json().dimensions[0];

    for (const [value, expectedStatus] of [[1, 201], [100, 201], [0, 400], [101, 400]] as [number, number][]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: { authorization: `Bearer ${parentToken}` },
        payload: {
          title: `任务_${value}`,
          dimension_id: dim.id,
          point_value: value,
          difficulty: 'easy',
          frequency: 'daily',
          age_group: '6-8',
        },
      });
      expect(response.statusCode).toBe(expectedStatus);
    }
  });

  // RED 2: rejects empty task title
  test('rejects empty task title', async () => {
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${parentToken}` },
    });
    const dim = dimsResp.json().dimensions[0];

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        title: '',
        dimension_id: dim.id,
        point_value: 2,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  // RED 3: rejects invalid dimension_id (not in family)
  test('rejects invalid dimension id', async () => {
    const fakeDimensionId = '00000000-0000-0000-0000-000000000000';

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        title: '无效维度任务',
        dimension_id: fakeDimensionId,
        point_value: 2,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('Business rule edge cases', () => {
  // RED 4: cannot check in for past date (if implementation enforces)
  test('rejects check-in for non-existent task', async () => {
    const today = new Date().toISOString().split('T')[0];
    const fakeTaskId = '00000000-0000-0000-0000-000000000000';

    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: fakeTaskId, date: today },
    });

    expect(response.statusCode).toBe(404);
  });

  // RED 5: cannot revoke already revoked checkin
  test('cannot revoke already revoked checkin', async () => {
    const taskId = await createTask(app, parentToken, { point_value: 2, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    // Check in
    const checkinResp = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });
    const checkinId = checkinResp.json().checkin.id;

    // First revoke (should succeed)
    const firstRevoke = await app.inject({
      method: 'POST',
      url: `/api/checkins/${checkinId}/revoke`,
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(firstRevoke.statusCode).toBe(200);

    // Second revoke (should fail with conflict)
    const secondRevoke = await app.inject({
      method: 'POST',
      url: `/api/checkins/${checkinId}/revoke`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    expect(secondRevoke.statusCode).toBe(400);
    expect(secondRevoke.json().error.code).toBe(3002); // ALREADY_REVOKED
  });

  // RED 6: invalid redemption transition rejected
  test('invalid redemption transition rejected', async () => {
    // Award points and create redemption
    const taskId = await createTask(app, parentToken, { point_value: 50, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });
    const redemptionResp = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });
    const redemptionId = redemptionResp.json().redemption.id;

    // Approve (pending → approved, valid)
    const approveResp = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'approved' },
    });
    expect(approveResp.statusCode).toBe(200);

    // Try to reject after approved (approved → rejected, invalid)
    const rejectResp = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'rejected' },
    });

    expect(rejectResp.statusCode).toBe(400);
  });

  // RED 7: child cannot access parent-only endpoints
  test('child token rejected on parent-only endpoint', async () => {
    // Child tries to create a task (parent-only route)
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${parentToken}` },
    });
    const dim = dimsResp.json().dimensions[0];

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        title: '孩子试图创建任务',
        dimension_id: dim.id,
        point_value: 2,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  // RED 8: unauthenticated requests are rejected
  test('unauthenticated request returns 403', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
    });

    expect(response.statusCode).toBe(403);
  });
});
