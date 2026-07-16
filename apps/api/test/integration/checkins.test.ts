import { describe, test, expect, beforeEach, afterEach } from 'vitest';
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
let taskId: string;

beforeEach(async () => {
  await cleanDatabase();
  app = await createTestApp();
  const reg = await registerParent({ email: 'checkins-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '打卡孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
  taskId = await createTask(app, parentToken, {
    title: '阅读30分钟',
    point_value: 2,
    age_group: '6-8',
  });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/checkins', () => {
  // RED 1: 孩子成功打卡
  test('child checks in a task and earns points', async () => {
    const today = new Date().toISOString().split('T')[0];
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.checkin).toBeDefined();
    expect(body.checkin.taskId).toBe(taskId);
    expect(body.pointsAwarded).toBe(2);
    expect(body.balanceAfter).toBe(2);
  });

  // RED 2: 重复打卡被拒
  test('rejects duplicate check-in for same task on same day', async () => {
    const today = new Date().toISOString().split('T')[0];
    // First checkin
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    // Second checkin same day
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    expect(response.statusCode).toBe(409);
  });

  // RED 3: 未认证请求被拒
  test('rejects unauthenticated request', async () => {
    const today = new Date().toISOString().split('T')[0];
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      payload: { task_id: taskId, date: today },
    });

    expect(response.statusCode).toBe(403);
  });

  // RED 4: 不存在的任务
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
});

describe('POST /api/checkins/:id/revoke', () => {
  // RED 1: 家长成功撤销打卡，积分扣回
  test('parent revokes a check-in, points are deducted', async () => {
    const today = new Date().toISOString().split('T')[0];
    // Child checks in first
    const checkinResp = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });
    const checkinId = checkinResp.json().checkin.id;
    expect(checkinResp.json().balanceAfter).toBe(2);

    // Parent revokes
    const response = await app.inject({
      method: 'POST',
      url: `/api/checkins/${checkinId}/revoke`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.checkin.revokedByParent).toBe(true);
    expect(body.balanceAfter).toBe(0);
  });

  // RED 2: 孩子不能撤销打卡
  test('child cannot revoke a check-in', async () => {
    const today = new Date().toISOString().split('T')[0];
    // Child checks in
    const checkinResp = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });
    const checkinId = checkinResp.json().checkin.id;

    // Child tries to revoke
    const response = await app.inject({
      method: 'POST',
      url: `/api/checkins/${checkinId}/revoke`,
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
