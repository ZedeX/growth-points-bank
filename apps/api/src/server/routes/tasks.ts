import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { requireParent, requireChild, requireFamilyId } from '../middleware/auth.js';
import { createTaskSchema } from '@gpb/shared';

const DIFFICULTY_MULT: Record<string, number> = { easy: 100, medium: 150, hard: 200 };

export async function taskRoutes(app: FastifyInstance) {
  // List tasks (parent sees all, child sees age-appropriate)
  app.get('/api/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;

    const conditions = [eq(schema.tasks.familyId, familyId), eq(schema.tasks.isActive, true)];

    // Child only sees tasks for their age group
    if (request.auth?.role === 'child') {
      // Need to fetch child's age_group
      const [child] = await db.select().from(schema.children)
        .where(and(eq(schema.children.id, request.auth.sub), eq(schema.children.familyId, familyId)))
        .limit(1);
      if (child) {
        conditions.push(eq(schema.tasks.ageGroup, child.ageGroup));
      }
    }

    const tasks = await db.select().from(schema.tasks)
      .where(and(...conditions))
      .orderBy(schema.tasks.createdAt);

    // Enrich with dimension info
    const dims = await db.select().from(schema.growthDimensions)
      .where(eq(schema.growthDimensions.familyId, familyId));
    const dimMap = new Map(dims.map(d => [d.id, d]));

    return {
      tasks: tasks.map(t => ({
        ...t,
        dimension: dimMap.get(t.dimensionId) || null,
        effective_points: Math.round(t.pointValue * t.difficultyMultiplier / 100),
      })),
    };
  });

  // Create task (parent only)
  app.post('/api/tasks', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    // Verify dimension belongs to family
    const [dim] = await db.select().from(schema.growthDimensions)
      .where(and(eq(schema.growthDimensions.id, parsed.data.dimension_id), eq(schema.growthDimensions.familyId, familyId)))
      .limit(1);
    if (!dim) {
      return reply.code(400).send({ error: { code: 9001, message: 'Invalid dimension' } });
    }

    const [task] = await db.insert(schema.tasks).values({
      familyId,
      dimensionId: parsed.data.dimension_id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      pointValue: parsed.data.point_value,
      difficulty: parsed.data.difficulty,
      difficultyMultiplier: DIFFICULTY_MULT[parsed.data.difficulty] || 100,
      frequency: parsed.data.frequency,
      ageGroup: parsed.data.age_group,
      isActive: parsed.data.is_active,
    }).returning();

    return reply.code(201).send(task);
  });

  // Update task
  app.patch('/api/tasks/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const [updated] = await db.update(schema.tasks).set({
      ...body,
      updatedAt: new Date(),
    }).where(and(eq(schema.tasks.id, id), eq(schema.tasks.familyId, familyId))).returning();

    if (!updated) {
      return reply.code(404).send({ error: { code: 9002, message: 'Task not found' } });
    }
    return updated;
  });

  // Soft-delete task
  app.delete('/api/tasks/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };

    const [updated] = await db.update(schema.tasks).set({
      isActive: false,
      updatedAt: new Date(),
    }).where(and(eq(schema.tasks.id, id), eq(schema.tasks.familyId, familyId))).returning();

    if (!updated) {
      return reply.code(404).send({ error: { code: 9002, message: 'Task not found' } });
    }
    return reply.code(204).send();
  });
}
