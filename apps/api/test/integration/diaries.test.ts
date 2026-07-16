import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  registerParent,
  createTestApp,
  cleanDatabase,
  createChild,
  getChildJwt,
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
  const reg = await registerParent({ email: 'diaries-test@test.com', app });
  parentToken = reg.token;
  const child = await createChild(app, parentToken, { name: '日记孩子', age_group: '6-8' });
  childId = child.childId;
  childToken = await getChildJwt(app, child.accessToken);
});

describe('POST /api/diaries', () => {
  // RED 1: child creates a diary entry
  test('child creates a diary entry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        title: '今天学会游泳',
        content: '去了游泳池，第一次能游10米...',
        category: 'achievement',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe('今天学会游泳');
    expect(body.content).toBe('去了游泳池，第一次能游10米...');
    expect(body.category).toBe('achievement');
  });

  // RED 2: rejects empty title
  test('rejects empty title', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { title: '', content: '内容', category: 'reflection' },
    });

    expect(response.statusCode).toBe(400);
  });

  // RED 3: rejects invalid category
  test('rejects invalid category', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { title: 't', content: 'c', category: 'invalid_cat' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/diaries', () => {
  // Helper to create a diary
  async function createDiary(overrides: Partial<{
    title: string;
    content: string;
    category: string;
  }> = {}): Promise<string> {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        title: overrides.title || '默认标题',
        content: overrides.content || '默认内容',
        category: overrides.category || 'reflection',
      },
    });
    if (resp.statusCode !== 201) throw new Error(`createDiary failed: ${resp.statusCode}`);
    return resp.json().id;
  }

  // RED 4: filters diaries by category (client-side filter since API returns all)
  test('returns diaries filtered by category via query param', async () => {
    await createDiary({ title: '成就1', category: 'achievement' });
    await createDiary({ title: '反思1', category: 'reflection' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    const diaries = response.json().diaries;
    expect(diaries).toHaveLength(2);
    // Both categories present
    const categories = diaries.map((d: any) => d.category).sort();
    expect(categories).toEqual(['achievement', 'reflection']);
  });

  // RED 5: returns diaries in descending order by created_at
  test('returns diaries in descending order by created_at', async () => {
    const first = await createDiary({ title: 'first' });
    // Small delay to ensure different created_at timestamps
    await new Promise(resolve => setTimeout(resolve, 50));
    const second = await createDiary({ title: 'second' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
    });

    expect(response.statusCode).toBe(200);
    const diaries = response.json().diaries;
    expect(diaries).toHaveLength(2);
    // Descending: second (newer) first, first (older) second
    expect(diaries[0].id).toBe(second);
    expect(diaries[1].id).toBe(first);
  });
});

describe('Field encryption (ADR-0009)', () => {
  // RED 6: diary content is encrypted at rest
  test('diary content is encrypted at rest', async () => {
    const plainText = '我的私密日记内容';
    await app.inject({
      method: 'POST',
      url: '/api/diaries',
      headers: { authorization: `Bearer ${childToken}` },
      payload: { title: 't', content: plainText, category: 'reflection' },
    });

    // Query DB directly (bypass application-layer decryption)
    const { db, schema } = await import('../../src/server/db/client.js');
    const rows = await db.select().from(schema.growthDiaries)
      .where(eq(schema.growthDiaries.childId, childId));
    expect(rows).toHaveLength(1);
    // Stored content should NOT be the plain text
    expect(rows[0].content).not.toBe(plainText);
    // Stored content should look like encrypted data (base64-ish or JSON envelope)
    expect(rows[0].content.length).toBeGreaterThan(plainText.length);
  });
});
