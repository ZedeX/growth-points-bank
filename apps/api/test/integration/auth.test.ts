import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerParent, loginParent, createTestApp, cleanDatabase } from './helpers';

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

describe('POST /api/auth/register', () => {
  // RED 1: 成功注册
  test('registers a new parent and returns token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'newparent@test.com',
        phone: '13800001111',
        password: 'Test1234!',
        family_name: '快乐家庭',
        parent_name: '张三',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.family.id).toBeDefined();
    expect(body.parent.name).toBe('张三');
  });

  // RED 2: 重复邮箱注册失败
  test('rejects duplicate email', async () => {
    await registerParent({ email: 'dup@test.com', app });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'dup@test.com',
        phone: '13800002222',
        password: 'Test1234!',
        family_name: '另一家庭',
        parent_name: '李四',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  // RED 3: 缺少必填字段
  test('rejects missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'incomplete@test.com',
        // missing password, family_name, parent_name
      },
    });

    expect(response.statusCode).toBe(400);
  });

  // RED 4: 密码太短
  test('rejects short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'shortpw@test.com',
        phone: '13800003333',
        password: '123',
        family_name: '测试家庭',
        parent_name: '短密码',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  // RED 1: 邮箱登录成功
  test('logs in with email and returns token', async () => {
    const { token } = await registerParent({ email: 'login@test.com', password: 'Test1234!', app });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email_or_phone: 'login@test.com', password: 'Test1234!' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeDefined();
    // Note: JWTs issued in the same second are deterministic (same iat),
    // so we cannot assert token !== registerToken. Both are valid JWTs
    // with the same payload, header, and secret — they will be identical.
    expect(response.json().token.split('.')).toHaveLength(3);
  });

  // RED 2: 错误密码失败
  test('rejects wrong password', async () => {
    await registerParent({ email: 'wrongpw@test.com', password: 'Test1234!', app });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email_or_phone: 'wrongpw@test.com', password: 'WrongPass!' },
    });

    expect(response.statusCode).toBe(401);
  });

  // RED 3: 不存在的用户
  test('rejects non-existent user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email_or_phone: 'nobody@test.com', password: 'Test1234!' },
    });

    expect(response.statusCode).toBe(401);
  });
});
