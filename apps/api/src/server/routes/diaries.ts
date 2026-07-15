import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and, desc } from 'drizzle-orm';
import { requireChild, requireParent, requireFamilyId } from '../middleware/auth.js';
import { encryptField, decryptField } from '../crypto/field-crypto.js';
import { createDiarySchema } from '@gpb/shared';

export async function diaryRoutes(app: FastifyInstance) {
  // List diaries
  app.get('/api/diaries', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;
    if (!childId) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id required' } });
    }

    const diaries = await db.select().from(schema.growthDiaries)
      .where(eq(schema.growthDiaries.childId, childId))
      .orderBy(desc(schema.growthDiaries.createdAt))
      .limit(50);

    return {
      diaries: diaries.map(d => ({
        id: d.id,
        childId: d.childId,
        title: decryptField('growth_diaries', d.id, d.title),
        content: decryptField('growth_diaries', d.id, d.content),
        category: d.category,
        weekStartDate: d.weekStartDate,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  });

  // Create diary (child)
  app.post('/api/diaries', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const childId = request.auth!.sub;
    const parsed = createDiarySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    return db.transaction(async (tx) => {
      const [diary] = await tx.insert(schema.growthDiaries).values({
        childId,
        title: parsed.data.title,  // encrypted below
        content: parsed.data.content,
        category: parsed.data.category,
        weekStartDate: parsed.data.week_start_date || null,
        createdByChild: true,
      }).returning();

      await tx.update(schema.growthDiaries).set({
        title: encryptField('growth_diaries', diary.id, parsed.data.title),
        content: encryptField('growth_diaries', diary.id, parsed.data.content),
      }).where(eq(schema.growthDiaries.id, diary.id));

      return reply.code(201).send({
        id: diary.id,
        title: parsed.data.title,
        content: parsed.data.content,
        category: diary.category,
        createdAt: diary.createdAt.toISOString(),
      });
    });
  });

  // Update diary
  app.patch('/api/diaries/:id', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const childId = request.auth!.sub;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updates: any = { updatedAt: new Date() };
    if (body.title) updates.title = encryptField('growth_diaries', id, body.title);
    if (body.content) updates.content = encryptField('growth_diaries', id, body.content);
    if (body.category) updates.category = body.category;

    const [updated] = await db.update(schema.growthDiaries).set(updates)
      .where(and(eq(schema.growthDiaries.id, id), eq(schema.growthDiaries.childId, childId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: { code: 9002, message: 'Diary not found' } });

    return {
      id: updated.id,
      title: body.title ? body.title : decryptField('growth_diaries', id, updated.title),
      content: body.content ? body.content : decryptField('growth_diaries', id, updated.content),
    };
  });

  // Delete diary
  app.delete('/api/diaries/:id', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const childId = request.auth!.sub;
    const { id } = request.params as { id: string };
    await db.delete(schema.growthDiaries)
      .where(and(eq(schema.growthDiaries.id, id), eq(schema.growthDiaries.childId, childId)));
    return reply.code(204).send();
  });
}
