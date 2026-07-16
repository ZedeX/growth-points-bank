import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerParent, createTestApp, cleanDatabase } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('POST /api/children', () => {
  // RED 1: 成功创建孩子
  test('creates a child profile under family', async () => {
    const { token, familyId } = await registerParent({ app });

    const response = await app.inject({
      method: 'POST',
      url: '/api/children',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: '小明',
        age_group: '6-8',
        avatar: null,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.familyId).toBe(familyId);
    expect(body.name).toBe('小明');
    expect(body.ageGroup).toBe('6-8');
    expect(body.accessToken).toBeDefined();
  });

  // RED 2: 未认证请求被拒
  test('rejects unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明', age_group: '6-8' },
    });

    expect(response.statusCode).toBe(403);
  });

  // RED 3: 重新生成孩子访问令牌
  test('regenerates access token for child', async () => {
    const { token } = await registerParent({ email: 'token-test@test.com', app });
    // Create a child
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/children',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '小孩', age_group: '9-11' },
    });
    expect(createResp.statusCode).toBe(201);
    const childId = createResp.json().id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/children/${childId}/regenerate-token`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeDefined();
    expect(response.json().tokenExpiresAt).toBeDefined();
  });
});

describe('GET /api/children', () => {
  test('lists children for family', async () => {
    const { token } = await registerParent({ email: 'list-children@test.com', app });

    // Create two children
    await app.inject({
      method: 'POST',
      url: '/api/children',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '孩子A', age_group: '6-8' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/children',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '孩子B', age_group: '9-11' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/children',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().children).toHaveLength(2);
  });
});
