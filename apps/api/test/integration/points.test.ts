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
  const reg = await registerParent({ email: 'points-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '积分孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

describe('GET /api/points/balance', () => {
  // RED 1: 新孩子余额为0
  test('returns 0 for new child', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().balance).toBe(0);
  });

  // RED 2: 打卡后余额正确
  test('returns correct balance after checkin', async () => {
    const taskId = await createTask(app, parentToken, { point_value: 5, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().balance).toBe(5);
  });
});

describe('GET /api/points/history', () => {
  // RED 1: 返回积分流水列表
  test('returns point transaction history', async () => {
    const taskId = await createTask(app, parentToken, { point_value: 3, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: taskId, date: today },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/points/history',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    const history = response.json().history;
    expect(history).toHaveLength(1);
    expect(history[0].amount).toBe(3);
    expect(history[0].sourceType).toBe('task');
    expect(history[0].balanceAfter).toBe(3);
  });

  // RED 2: 按时间倒序排列
  test('returns transactions in reverse chronological order', async () => {
    const task1 = await createTask(app, parentToken, { title: '任务1', point_value: 2, age_group: '6-8' });
    const task2 = await createTask(app, parentToken, { title: '任务2', point_value: 3, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    // Create two checkins
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task1, date: today },
    });
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { task_id: task2, date: today },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/points/history',
      headers: { authorization: `Bearer ${childToken}` },
    });

    const history = response.json().history;
    expect(history).toHaveLength(2);
    // Both have the same sourceType='task', check balanceAfter progression
    expect(history[0].balanceAfter).toBeGreaterThan(history[1].balanceAfter);
  });
});
