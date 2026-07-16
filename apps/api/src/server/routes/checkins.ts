import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireChild, requireParent, requireFamilyId } from '../middleware/auth.js';
import { recordPointsTx, withSerializableRetry, getBalance, getChildPointsHistory } from '../services/points.js';
import { createCheckinSchema } from '@gpb/shared';

export async function checkinRoutes(app: FastifyInstance) {
  // Create check-in (child only)
  app.post('/api/checkins', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.sub;
    const parsed = createCheckinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    // Verify task belongs to family and is active
    const [task] = await db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.id, parsed.data.task_id), eq(schema.tasks.familyId, familyId), eq(schema.tasks.isActive, true)))
      .limit(1);
    if (!task) {
      return reply.code(404).send({ error: { code: 5001, message: 'Task not found' } });
    }

    // Verify child's age group matches task
    const [child] = await db.select().from(schema.children)
      .where(eq(schema.children.id, childId)).limit(1);
    if (child?.ageGroup !== task.ageGroup) {
      return reply.code(400).send({ error: { code: 5002, message: 'Task age group mismatch' } });
    }

    try {
      const result = await withSerializableRetry(async () => {
        return db.transaction((tx) => {
          // Insert check-in
          const [checkin] = tx.insert(schema.checkins).values({
            childId,
            taskId: task.id,
            date: parsed.data.date,
            note: parsed.data.note || null,
          }).returning().all();

          // Award points
          const effectivePoints = Math.round(task.pointValue * task.difficultyMultiplier / 100);
          const pointsResult = recordPointsTx(tx, childId, effectivePoints, 'task', checkin.id);

          return { checkin, pointsAwarded: effectivePoints, balanceAfter: pointsResult.balanceAfter };
        });
      });

      return reply.code(201).send(result);
    } catch (err: any) {
      const sqliteErr = err?.cause || err;
      if (sqliteErr?.code === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteErr?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return reply.code(409).send({ error: { code: 3002, message: 'Already checked in for this task today' } });
      }
      throw err;
    }
  });

  // List check-ins for child
  app.get('/api/checkins', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;

    if (!childId) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id required for parent' } });
    }

    const checkins = await db.select({
      id: schema.checkins.id,
      taskId: schema.checkins.taskId,
      date: schema.checkins.date,
      note: schema.checkins.note,
      revoked: schema.checkins.revokedByParent,
      createdAt: schema.checkins.createdAt,
      taskTitle: schema.tasks.title,
      taskPointValue: schema.tasks.pointValue,
      dimensionId: schema.tasks.dimensionId,
    })
      .from(schema.checkins)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.checkins.taskId))
      .where(and(eq(schema.checkins.childId, childId), eq(schema.tasks.familyId, familyId)))
      .orderBy(sql`${schema.checkins.date} DESC, ${schema.checkins.createdAt} DESC`);

    return { checkins };
  });

  // Revoke check-in (parent only)
  app.post('/api/checkins/:id/revoke', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };

    const result = await withSerializableRetry(async () => {
      return db.transaction((tx) => {
        // Fetch existing checkin first to get taskId (need it to compute points to deduct)
        const [existing] = tx.select().from(schema.checkins)
          .where(eq(schema.checkins.id, id)).limit(1).all();
        if (!existing) throw { code: 9002, message: 'Check-in not found' };
        if (existing.revokedByParent) throw { code: 3002, message: 'Already revoked' };

        // Look up the task to compute the effective points that were awarded
        const [task] = tx.select().from(schema.tasks)
          .where(eq(schema.tasks.id, existing.taskId)).limit(1).all();
        const effectivePoints = task
          ? Math.round(task.pointValue * task.difficultyMultiplier / 100)
          : 0;

        const [checkin] = tx.update(schema.checkins).set({
          revokedByParent: true,
          revokedAt: new Date().toISOString(),
        }).where(eq(schema.checkins.id, id)).returning().all();

        // Deduct the same amount that was originally awarded
        const pointsResult = recordPointsTx(tx, checkin.childId, -effectivePoints, 'revocation', checkin.id);
        return { checkin, balanceAfter: pointsResult.balanceAfter };
      });
    });

    return result;
  });

  // Get balance
  app.get('/api/points/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;
    if (!childId) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id required' } });
    }
    const balance = await getBalance(childId);
    return { balance };
  });

  // Get points history
  app.get('/api/points/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;
    if (!childId) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id required' } });
    }
    const history = await getChildPointsHistory(childId);
    return { history };
  });
}
