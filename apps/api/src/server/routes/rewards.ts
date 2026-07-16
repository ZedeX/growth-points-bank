import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireParent, requireChild, requireFamilyId } from '../middleware/auth.js';
import { recordPointsTx, withSerializableRetry, getBalance } from '../services/points.js';
import { createRewardSchema, createRedemptionSchema, updateRedemptionSchema } from '@gpb/shared';

export async function rewardRoutes(app: FastifyInstance) {
  // List rewards
  app.get('/api/rewards', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const rewards = await db.select().from(schema.rewards)
      .where(and(eq(schema.rewards.familyId, familyId), eq(schema.rewards.isActive, true)))
      .orderBy(schema.rewards.createdAt);
    return { rewards };
  });

  // Create reward (parent only)
  app.post('/api/rewards', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const parsed = createRewardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }
    const [reward] = await db.insert(schema.rewards).values({
      familyId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      pointCost: parsed.data.point_cost,
      totalInventory: parsed.data.total_inventory,
      weeklyLimitPerChild: parsed.data.weekly_limit_per_child,
      icon: parsed.data.icon || null,
    }).returning();
    return reply.code(201).send(reward);
  });

  // Update reward
  app.patch('/api/rewards/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const [updated] = await db.update(schema.rewards).set({
      ...body,
      updatedAt: new Date(),
    }).where(and(eq(schema.rewards.id, id), eq(schema.rewards.familyId, familyId))).returning();
    if (!updated) return reply.code(404).send({ error: { code: 9002, message: 'Reward not found' } });
    return updated;
  });

  // Delete (soft) reward
  app.delete('/api/rewards/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    await db.update(schema.rewards).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(schema.rewards.id, id), eq(schema.rewards.familyId, familyId)));
    return reply.code(204).send();
  });

  // Create redemption (child)
  app.post('/api/redemptions', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.sub;
    const parsed = createRedemptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    // Verify reward
    const [reward] = await db.select().from(schema.rewards)
      .where(and(eq(schema.rewards.id, parsed.data.reward_id), eq(schema.rewards.familyId, familyId), eq(schema.rewards.isActive, true)))
      .limit(1);
    if (!reward) {
      return reply.code(404).send({ error: { code: 4003, message: 'Reward not available' } });
    }

    // Check inventory
    if (reward.totalClaimed >= reward.totalInventory) {
      return reply.code(400).send({ error: { code: 4001, message: 'Reward out of stock' } });
    }

    // Check weekly limit
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekCountResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM app.reward_redemptions
      WHERE child_id = ${childId} AND reward_id = ${reward.id}
        AND redeemed_at >= ${weekStart}
        AND status NOT IN ('cancelled', 'rejected')
    `);

    if (Number(weekCountResult.rows[0]?.cnt ?? 0) >= reward.weeklyLimitPerChild) {
      return reply.code(400).send({ error: { code: 4002, message: 'Weekly limit reached' } });
    }

    try {
      const result = await withSerializableRetry(async () => {
        return db.transaction(async (tx) => {
          // Deduct points
          const pointsResult = await recordPointsTx(tx, childId, -reward.pointCost, 'reward', reward.id);

          // Create redemption
          const [redemption] = await tx.insert(schema.rewardRedemptions).values({
            childId,
            rewardId: reward.id,
            pointCost: reward.pointCost,
            status: 'pending',
          }).returning();

          // Increment claimed count
          await tx.update(schema.rewards).set({
            totalClaimed: sql`${schema.rewards.totalClaimed} + 1`,
            updatedAt: new Date(),
          }).where(eq(schema.rewards.id, reward.id));

          return { redemption, balanceAfter: pointsResult.balanceAfter };
        });
      });
      return reply.code(201).send(result);
    } catch (err: any) {
      if (err.code === 3001) {
        return reply.code(400).send({ error: { code: 3001, message: 'Insufficient balance' } });
      }
      throw err;
    }
  });

  // List redemptions
  app.get('/api/redemptions', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;

    const conditions = [eq(schema.rewards.familyId, familyId)];
    if (childId) {
      conditions.push(eq(schema.rewardRedemptions.childId, childId));
    }

    const redemptions = await db.select({
      id: schema.rewardRedemptions.id,
      childId: schema.rewardRedemptions.childId,
      rewardId: schema.rewardRedemptions.rewardId,
      rewardTitle: schema.rewards.title,
      rewardIcon: schema.rewards.icon,
      pointCost: schema.rewardRedemptions.pointCost,
      status: schema.rewardRedemptions.status,
      parentNote: schema.rewardRedemptions.parentNote,
      redeemedAt: schema.rewardRedemptions.redeemedAt,
      approvedAt: schema.rewardRedemptions.approvedAt,
      fulfilledAt: schema.rewardRedemptions.fulfilledAt,
    })
      .from(schema.rewardRedemptions)
      .innerJoin(schema.rewards, eq(schema.rewards.id, schema.rewardRedemptions.rewardId))
      .where(and(...conditions))
      .orderBy(sql`${schema.rewardRedemptions.redeemedAt} DESC`);

    return { redemptions };
  });

  // Update redemption status (parent only)
  app.patch('/api/redemptions/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    const parsed = updateRedemptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    // Get redemption with reward to verify family
    const [redemption] = await db.select()
      .from(schema.rewardRedemptions)
      .innerJoin(schema.rewards, eq(schema.rewards.id, schema.rewardRedemptions.rewardId))
      .where(and(eq(schema.rewardRedemptions.id, id), eq(schema.rewards.familyId, familyId)))
      .limit(1);

    if (!redemption) {
      return reply.code(404).send({ error: { code: 9002, message: 'Redemption not found' } });
    }

    const now = new Date();
    const updateData: any = { status: parsed.data.status, updatedAt: now };
    if (parsed.data.parent_note) updateData.parentNote = parsed.data.parent_note;
    if (parsed.data.status === 'approved') updateData.approvedAt = now;
    if (parsed.data.status === 'fulfilled') updateData.fulfilledAt = now;

    // If rejected, refund points
    if (parsed.data.status === 'rejected' || parsed.data.status === 'cancelled') {
      await withSerializableRetry(async () => {
        return db.transaction(async (tx) => {
          await tx.update(schema.rewardRedemptions).set(updateData).where(eq(schema.rewardRedemptions.id, id));
          // Refund: positive amount with 'revocation' source
          await recordPointsTx(tx, redemption.reward_redemptions.childId, redemption.reward_redemptions.pointCost, 'revocation', redemption.reward_redemptions.id);
        });
      });
    } else {
      await db.update(schema.rewardRedemptions).set(updateData).where(eq(schema.rewardRedemptions.id, id));
    }

    return { id, status: parsed.data.status };
  });
}
