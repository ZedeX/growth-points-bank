// Integration test helpers: build app, auth utilities, database cleanup.
// Uses Fastify's built-in inject() method for HTTP testing without a real server.

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { db, schema } from '../../src/server/db/client.js';
import { sql } from 'drizzle-orm';

export interface TestContext {
  app: FastifyInstance;
}

/**
 * Build a Fastify app instance for testing.
 */
export async function createTestApp(): Promise<FastifyInstance> {
  return buildApp();
}

/**
 * Clean all tables between tests for isolation.
 * Truncates all tables in the app schema (cascade).
 */
export async function cleanDatabase(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE
    app.conflict_alerts,
    app.audit_logs,
    app.notifications,
    app.growth_diaries,
    app.weekly_review_access_log,
    app.weekly_reviews,
    app.reward_redemptions,
    app.rewards,
    app.point_transactions,
    app.checkins,
    app.tasks,
    app.growth_dimensions,
    app.children,
    app.parents,
    app.families
  CASCADE`);
}

/**
 * Register a parent and return the auth token + family info.
 * Pass `app` to reuse an existing Fastify instance (avoids creating a
 * duplicate app that would never be closed). If omitted, a new app is
 * created and returned.
 */
export async function registerParent(overrides: Partial<{
  email: string;
  phone: string;
  password: string;
  family_name: string;
  parent_name: string;
  app: FastifyInstance;
}> = {}): Promise<{
  token: string;
  familyId: string;
  parentId: string;
  app: FastifyInstance;
}> {
  const app = overrides.app ?? await createTestApp();
  const suffix = Math.random().toString(36).slice(2, 10);
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: overrides.email || `parent-${suffix}@test.com`,
      phone: overrides.phone || `138${suffix.slice(0, 8)}`,
      password: overrides.password || 'Test1234!',
      family_name: overrides.family_name || '测试家庭',
      parent_name: overrides.parent_name || '测试家长',
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Register failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  return {
    token: body.token,
    familyId: body.family.id,
    parentId: body.parent.id,
    app,
  };
}

/**
 * Login as parent and return the auth token.
 */
export async function loginParent(
  app: FastifyInstance,
  emailOrPhone: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email_or_phone: emailOrPhone, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  }

  return response.json().token;
}

/**
 * Create a child and return the child's access token + id.
 */
export async function createChild(
  app: FastifyInstance,
  parentToken: string,
  overrides: Partial<{ name: string; age_group: string; avatar: string }> = {},
): Promise<{ childId: string; accessToken: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/children',
    headers: { authorization: `Bearer ${parentToken}` },
    payload: {
      name: overrides.name || '小明',
      age_group: overrides.age_group || '6-8',
      avatar: overrides.avatar || null,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Create child failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  return { childId: body.id, accessToken: body.accessToken };
}

/**
 * Exchange a child access token for a child JWT.
 */
export async function getChildJwt(
  app: FastifyInstance,
  accessToken: string,
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/child/auth?token=${accessToken}`,
  });

  if (response.statusCode !== 200) {
    throw new Error(`Child auth failed: ${response.statusCode} ${response.body}`);
  }

  return response.json().token;
}

/**
 * Full setup: register parent, create child, get child JWT.
 * Returns everything needed for checkin/reward tests.
 */
export async function setupFamilyWithChild(overrides: Partial<{
  childName: string;
  ageGroup: string;
  app: FastifyInstance;
}> = {}): Promise<{
  app: FastifyInstance;
  parentToken: string;
  familyId: string;
  childId: string;
  childToken: string;
}> {
  const app = overrides.app ?? await createTestApp();
  const { token, familyId } = await registerParent({ app });
  const { childId, accessToken } = await createChild(app, token, {
    name: overrides.childName || '小明',
    age_group: overrides.ageGroup || '6-8',
  });
  const childToken = await getChildJwt(app, accessToken);

  return { app, parentToken: token, familyId, childId, childToken };
}

/**
 * Create a task and return its id.
 */
export async function createTask(
  app: FastifyInstance,
  parentToken: string,
  overrides: Partial<{
    title: string;
    dimension_code: string;
    point_value: number;
    frequency: string;
    difficulty: string;
    age_group: string;
  }> = {},
): Promise<string> {
  // First get dimensions to find the dimension id
  const dimsResponse = await app.inject({
    method: 'GET',
    url: '/api/dimensions',
    headers: { authorization: `Bearer ${parentToken}` },
  });

  if (dimsResponse.statusCode !== 200) {
    throw new Error(`Get dimensions failed: ${dimsResponse.statusCode}`);
  }

  const dimensions = dimsResponse.json().dimensions;
  const dimCode = overrides.dimension_code || 'learning';
  const dimension = dimensions.find((d: any) => d.code === dimCode) || dimensions[0];

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { authorization: `Bearer ${parentToken}` },
    payload: {
      title: overrides.title || '阅读30分钟',
      dimension_id: dimension.id,
      point_value: overrides.point_value ?? 2,
      frequency: overrides.frequency || 'daily',
      difficulty: overrides.difficulty || 'easy',
      age_group: overrides.age_group || '6-8',
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Create task failed: ${response.statusCode} ${response.body}`);
  }

  return response.json().id;
}

/**
 * Create a reward and return its id.
 */
export async function createReward(
  app: FastifyInstance,
  parentToken: string,
  overrides: Partial<{
    title: string;
    point_cost: number;
    total_inventory: number;
    weekly_limit_per_child: number;
  }> = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/rewards',
    headers: { authorization: `Bearer ${parentToken}` },
    payload: {
      title: overrides.title || '家庭电影',
      point_cost: overrides.point_cost ?? 10,
      total_inventory: overrides.total_inventory ?? 999,
      weekly_limit_per_child: overrides.weekly_limit_per_child ?? 1,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Create reward failed: ${response.statusCode} ${response.body}`);
  }

  return response.json().id;
}

/**
 * Helper to make an authenticated request.
 */
export async function authRequest(
  app: FastifyInstance,
  method: string,
  url: string,
  token: string,
  payload?: any,
): Promise<{ statusCode: number; body: any; json: () => any }> {
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

  return {
    statusCode: response.statusCode,
    body: response.body,
    json: () => response.json(),
  };
}
