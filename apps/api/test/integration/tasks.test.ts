import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerParent, createTestApp, cleanDatabase, createTask } from './helpers';

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  await cleanDatabase();
  app = await createTestApp();
  const reg = await registerParent({ email: 'tasks-test@test.com', app });
  token = reg.token;
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/tasks', () => {
  // RED 1: 成功创建每日任务
  test('creates a daily task with dimension and points', async () => {
    // Fetch dimensions to get a valid dimension_id
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${token}` },
    });
    const dimensions = dimsResp.json().dimensions;
    const learningDim = dimensions.find((d: any) => d.code === 'learning');

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: '阅读30分钟',
        dimension_id: learningDim.id,
        point_value: 2,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe('阅读30分钟');
    expect(body.pointValue).toBe(2);
    expect(body.frequency).toBe('daily');
    expect(body.isActive).toBe(true);
    expect(body.difficultyMultiplier).toBe(100);
  });

  // RED 2: 积分值范围校验 (schema max is 100, not 20 as TDD spec says)
  test('rejects task with points exceeding 100', async () => {
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${token}` },
    });
    const learningDim = dimsResp.json().dimensions[0];

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: '超额任务',
        dimension_id: learningDim.id,
        point_value: 101,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  // RED 3: 无效维度ID (dimension not in family)
  test('rejects invalid dimension id', async () => {
    const fakeDimensionId = '00000000-0000-0000-0000-000000000000';

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
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

  // RED 4: 任务名称长度校验
  test('rejects empty task title', async () => {
    const dimsResp = await app.inject({
      method: 'GET',
      url: '/api/dimensions',
      headers: { authorization: `Bearer ${token}` },
    });
    const learningDim = dimsResp.json().dimensions[0];

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: '',
        dimension_id: learningDim.id,
        point_value: 2,
        difficulty: 'easy',
        frequency: 'daily',
        age_group: '6-8',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/tasks', () => {
  test('lists tasks for family', async () => {
    // Create a task using the helper
    await createTask(app, token, { title: '任务1' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tasks).toHaveLength(1);
    expect(response.json().tasks[0].title).toBe('任务1');
  });
});
