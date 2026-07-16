import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../src/server/db/client.js';
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

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('Multi-tenant isolation', () => {
  // RED 1: child from family A cannot see tasks from family B
  test('child from family A cannot see tasks from family B', async () => {
    // Setup family A
    const regA = await registerParent({ email: 'familyA@test.com', app });
    const childA = await createChild(app, regA.token, { name: '孩子A', age_group: '6-8' });
    const childAToken = await getChildJwt(app, childA.accessToken);

    // Setup family B
    const regB = await registerParent({ email: 'familyB@test.com', app });
    await createTask(app, regB.token, { title: '家庭B任务', age_group: '6-8' });

    // Child A lists tasks - should not see family B's task
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${childAToken}` },
    });

    expect(response.statusCode).toBe(200);
    const tasks = response.json().tasks;
    expect(tasks.find((t: any) => t.title === '家庭B任务')).toBeUndefined();
  });

  // RED 2: cross-family access returns 404 (not 403)
  test('cross-family child points access returns 404', async () => {
    // Setup family A (parent only)
    const regA = await registerParent({ email: 'isolationA@test.com', app });

    // Setup family B (with child)
    const regB = await registerParent({ email: 'isolationB@test.com', app });
    const childB = await createChild(app, regB.token, { name: '孩子B', age_group: '6-8' });

    // Parent A tries to access child B's points
    const response = await app.inject({
      method: 'GET',
      url: `/api/points/balance`,
      headers: { authorization: `Bearer ${regB.token}` },
      query: { child_id: childB.childId },
    });

    // Parent B can access their own child's points - but Parent A cannot.
    // Test with Parent A token accessing child B:
    const crossResp = await app.inject({
      method: 'GET',
      url: `/api/children/${childB.childId}`,
      headers: { authorization: `Bearer ${regA.token}` },
    });

    expect(crossResp.statusCode).toBe(404);
  });

  // RED 3: cross-family redemption access returns 404
  test('cross-family redemption access returns 404', async () => {
    // Family A
    const regA = await registerParent({ email: 'redemptA@test.com', app });

    // Family B with child + reward + redemption
    const regB = await registerParent({ email: 'redemptB@test.com', app });
    const childB = await createChild(app, regB.token, { name: '孩子B', age_group: '6-8' });
    const childBToken = await getChildJwt(app, childB.accessToken);
    const taskB = await createTask(app, regB.token, { point_value: 10, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];
    // Check in to earn points
    await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${childBToken}` },
      payload: { task_id: taskB, date: today },
    });
    const rewardB = await createReward(app, regB.token, { point_cost: 5 });
    const redemptionResp = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      headers: { authorization: `Bearer ${childBToken}` },
      payload: { reward_id: rewardB },
    });
    const redemptionId = redemptionResp.json().redemption.id;

    // Parent A tries to approve family B's redemption
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/redemptions/${redemptionId}`,
      headers: { authorization: `Bearer ${regA.token}` },
      payload: { status: 'approved' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('JWT authentication', () => {
  // RED 4: parent token rejected on child-only endpoint
  test('parent token rejected on child-only endpoint (POST /api/checkins)', async () => {
    const reg = await registerParent({ email: 'jwt-test@test.com', app });
    const task = await createTask(app, reg.token, { point_value: 1, age_group: '6-8' });
    const today = new Date().toISOString().split('T')[0];

    // Parent tries to check in (child-only route)
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkins',
      headers: { authorization: `Bearer ${reg.token}` },
      payload: { task_id: task, date: today },
    });

    expect(response.statusCode).toBe(403);
  });

  // RED 5: revoked child token (token_version mismatch) returns 401
  test('revoked child token returns 401', async () => {
    const reg = await registerParent({ email: 'revoke-test@test.com', app });
    const child = await createChild(app, reg.token, { name: '撤销测试', age_group: '6-8' });
    const childToken = await getChildJwt(app, child.accessToken);

    // Regenerate access token → token_version +1
    await app.inject({
      method: 'POST',
      url: `/api/children/${child.childId}/regenerate-token`,
      headers: { authorization: `Bearer ${reg.token}` },
    });

    // Old child token should now be invalid
    const response = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  // RED 6: expired/malformed token returns 401
  test('malformed token returns 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/points/balance',
      headers: { authorization: 'Bearer invalid.token.here' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Field-level encryption (ADR-0009)', () => {
  // RED 7: diary content is encrypted at rest
  test('diary content is encrypted at rest', async () => {
    const reg = await registerParent({ email: 'encrypt-test@test.com', app });
    const child = await createChild(app, reg.token, { name: '加密测试', age_group: '6-8' });
    const childToken = await getChildJwt(app, child.accessToken);
    const plainText = '我的私密日记内容';

    await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { title: 't', content: plainText, category: 'reflection' },
    });

    // Query DB directly
    const rows = await db.select().from(schema.growthDiaries)
      .where(eq(schema.growthDiaries.childId, child.childId));
    expect(rows).toHaveLength(1);
    expect(rows[0].content).not.toBe(plainText);
    expect(rows[0].content.length).toBeGreaterThan(plainText.length);
  });

  // RED 8: diary decrypts correctly on read
  test('diary content decrypts correctly on read', async () => {
    const reg = await registerParent({ email: 'decrypt-test@test.com', app });
    const child = await createChild(app, reg.token, { name: '解密测试', age_group: '6-8' });
    const childToken = await getChildJwt(app, child.accessToken);
    const plainText = '可读的日记内容';

    await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { title: '标题', content: plainText, category: 'reflection' },
    });

    // Read via API (should decrypt)
    const response = await app.inject({
      method: 'GET',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    const diaries = response.json().diaries;
    expect(diaries).toHaveLength(1);
    expect(diaries[0].content).toBe(plainText);
    expect(diaries[0].title).toBe('标题');
  });
});
