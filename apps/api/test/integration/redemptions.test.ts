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
  const reg = await registerParent({ email: 'redemptions-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '兑换孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

afterEach(async () => {
  await app.close();
});

// Helper: award points to child by creating tasks and checking in
async function awardPoints(points: number): Promise<void> {
  const taskId = await createTask(app, parentToken, { point_value: points, age_group: '6-8' });
  const today = new Date().toISOString().split('T')[0];
  const resp = await app.inject({
    method: 'POST',
    url: '/api/checkins',
    headers: { authorization: `Bearer ${childToken}` },
    payload: { task_id: taskId, date: today },
  });
  if (resp.statusCode !== 201) throw new Error(`Award points failed: ${resp.statusCode} ${resp.body}`);
}

describe('POST /api/redemptions', () => {
  // RED 1: 孩子发起兑换请求 (points deducted immediately per implementation)
  test('child creates a redemption request', async () => {
    await awardPoints(50);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.redemption).toBeDefined();
    expect(body.redemption.status).toBe('pending');
    expect(body.redemption.pointCost).toBe(30);
    // Points are deducted immediately in this implementation
    expect(body.balanceAfter).toBe(20);
  });

  // RED 2: 积分不足时发起兑换被拒
  test('rejects redemption when insufficient points', async () => {
    await awardPoints(10);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(3001);
  });
});

describe('PATCH /api/redemptions/:id', () => {
  // RED 1: 家长审核通过
  test('parent approves redemption', async () => {
    await awardPoints(50);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });
    const redemptionId = createResp.json().redemption.id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'approved', parent_note: '表现很好' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('approved');
  });

  // RED 2: 家长拒绝，积分退还
  test('parent rejects redemption, points are refunded', async () => {
    await awardPoints(50);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });
    const redemptionId = createResp.json().redemption.id;
    // Balance should be 20 after redemption (50-30)
    expect(createResp.json().balanceAfter).toBe(20);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'rejected', parent_note: '再坚持一周' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('rejected');

    // Verify points refunded
    const balanceResp = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(balanceResp.json().balance).toBe(50);
  });

  // RED 3: 家长标记已兑现
  test('parent marks redemption as fulfilled', async () => {
    await awardPoints(50);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { reward_id: rewardId },
    });
    const redemptionId = createResp.json().redemption.id;

    // Approve first
    await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'approved' },
    });

    // Then fulfill
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { status: 'fulfilled' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('fulfilled');
  });

  // RED 4: 未认证请求被拒
  test('rejects unauthenticated request', async () => {
    await awardPoints(50);
    const rewardId = await createReward(app, parentToken, { point_cost: 30 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      payload: { reward_id: rewardId },
    });

    expect(response.statusCode).toBe(403);
  });
});
