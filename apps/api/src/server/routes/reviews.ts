import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { requireParent, requireChild, requireFamilyId } from '../middleware/auth.js';
import { submitChildReviewSchema, submitParentReviewSchema } from '@gpb/shared';

export async function reviewRoutes(app: FastifyInstance) {
  // Get weekly review
  app.get('/api/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const childId = request.auth!.role === 'child' ? request.auth!.sub : (request.query as any)?.child_id;
    const weekStart = (request.query as any)?.week_start_date;

    if (!childId || !weekStart) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id and week_start_date required' } });
    }

    const [review] = await db.select().from(schema.weeklyReviews)
      .where(and(eq(schema.weeklyReviews.childId, childId), eq(schema.weeklyReviews.weekStartDate, weekStart)))
      .limit(1);

    if (!review) {
      return { review: null };
    }

    const selfCommitted = request.auth!.role === 'child' ? review.childCommittedAt : review.parentCommittedAt;
    const otherCommitted = request.auth!.role === 'child' ? review.parentCommittedAt : review.childCommittedAt;
    const locked = !!review.lockedAt;

    // Own content always visible
    const ownContent = request.auth!.role === 'child'
      ? { best_thing: review.bestThing, difficulty: review.difficulty, child_request: review.childRequest }
      : { parent_observation: review.parentObservation };

    // Other's content only if both committed
    let otherContent: any;
    if (selfCommitted && otherCommitted && locked) {
      otherContent = request.auth!.role === 'child'
        ? { parent_observation: review.parentObservation }
        : { best_thing: review.bestThing, difficulty: review.difficulty, child_request: review.childRequest };
    } else if (otherCommitted) {
      otherContent = { status: 'other_committed_waiting_for_you' };
    } else {
      otherContent = { status: 'other_not_started' };
    }

    // Log access
    await db.insert(schema.weeklyReviewAccessLog).values({
      reviewId: review.id,
      readerRole: request.auth!.role,
      fieldRead: locked ? 'other' : 'own',
    });

    return {
      review: {
        ...ownContent,
        other: otherContent,
        self_committed: !!selfCommitted,
        locked,
        task_count: review.taskCount,
        point_earned: review.pointEarned,
        dimension_count: review.dimensionCount,
      },
    };
  });

  // Submit child review
  app.post('/api/reviews/child', {
    preHandler: [requireChild],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const childId = request.auth!.sub;
    const parsed = submitChildReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    const now = new Date().toISOString();
    const weekStart = parsed.data.week_start_date;

    // Check existing
    const [existing] = await db.select().from(schema.weeklyReviews)
      .where(and(eq(schema.weeklyReviews.childId, childId), eq(schema.weeklyReviews.weekStartDate, weekStart)))
      .limit(1);

    if (existing?.lockedAt) {
      return reply.code(409).send({ error: { code: 6001, message: 'Review already locked' } });
    }

    const bothCommitted = !!existing?.parentCommittedAt;
    const reviewId = randomUUID();

    db.run(sql`
      INSERT INTO weekly_reviews (id, child_id, week_start_date, best_thing, difficulty, child_request, child_committed_at, locked_at, updated_at, created_at)
      VALUES (${reviewId}, ${childId}, ${weekStart}, ${parsed.data.best_thing}, ${parsed.data.difficulty}, ${parsed.data.child_request}, ${now}, NULL, ${now}, ${now})
      ON CONFLICT (child_id, week_start_date) DO UPDATE SET
        best_thing = EXCLUDED.best_thing,
        difficulty = EXCLUDED.difficulty,
        child_request = EXCLUDED.child_request,
        child_committed_at = ${now},
        locked_at = CASE WHEN weekly_reviews.parent_committed_at IS NOT NULL THEN ${now} ELSE weekly_reviews.locked_at END,
        updated_at = ${now}
    `);

    // If locked, compute aggregates
    if (bothCommitted) {
      db.run(sql`
        UPDATE weekly_reviews SET
          task_count = (SELECT COUNT(*) FROM checkins WHERE child_id = ${childId} AND date >= ${weekStart} AND date < date(${weekStart}, '+7 days') AND revoked_by_parent = 0),
          point_earned = (SELECT COALESCE(SUM(amount), 0) FROM point_transactions WHERE child_id = ${childId} AND amount > 0 AND created_at >= ${weekStart} AND created_at < date(${weekStart}, '+7 days')),
          dimension_count = (
            SELECT COUNT(DISTINCT t.dimension_id) FROM checkins c
            JOIN tasks t ON t.id = c.task_id
            WHERE c.child_id = ${childId} AND c.date >= ${weekStart} AND c.date < date(${weekStart}, '+7 days')
              AND c.revoked_by_parent = 0
          )
        WHERE child_id = ${childId} AND week_start_date = ${weekStart}
      `);
    }

    return { status: 'submitted', locked: bothCommitted };
  });

  // Submit parent review
  app.post('/api/reviews/parent', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const parsed = submitParentReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }

    const { child_id } = request.body as any;
    if (!child_id) {
      return reply.code(400).send({ error: { code: 9001, message: 'child_id required' } });
    }

    const now = new Date().toISOString();
    const weekStart = parsed.data.week_start_date;

    const [existing] = await db.select().from(schema.weeklyReviews)
      .where(and(eq(schema.weeklyReviews.childId, child_id), eq(schema.weeklyReviews.weekStartDate, weekStart)))
      .limit(1);

    if (existing?.lockedAt) {
      return reply.code(409).send({ error: { code: 6001, message: 'Review already locked' } });
    }

    const bothCommitted = !!existing?.childCommittedAt;
    const reviewId = randomUUID();

    db.run(sql`
      INSERT INTO weekly_reviews (id, child_id, week_start_date, parent_observation, parent_committed_at, locked_at, updated_at, created_at)
      VALUES (${reviewId}, ${child_id}, ${weekStart}, ${parsed.data.parent_observation}, ${now}, NULL, ${now}, ${now})
      ON CONFLICT (child_id, week_start_date) DO UPDATE SET
        parent_observation = EXCLUDED.parent_observation,
        parent_committed_at = ${now},
        locked_at = CASE WHEN weekly_reviews.child_committed_at IS NOT NULL THEN ${now} ELSE weekly_reviews.locked_at END,
        updated_at = ${now}
    `);

    if (bothCommitted) {
      db.run(sql`
        UPDATE weekly_reviews SET
          task_count = (SELECT COUNT(*) FROM checkins WHERE child_id = ${child_id} AND date >= ${weekStart} AND date < date(${weekStart}, '+7 days') AND revoked_by_parent = 0),
          point_earned = (SELECT COALESCE(SUM(amount), 0) FROM point_transactions WHERE child_id = ${child_id} AND amount > 0 AND created_at >= ${weekStart} AND created_at < date(${weekStart}, '+7 days')),
          dimension_count = (
            SELECT COUNT(DISTINCT t.dimension_id) FROM checkins c
            JOIN tasks t ON t.id = c.task_id
            WHERE c.child_id = ${child_id} AND c.date >= ${weekStart} AND c.date < date(${weekStart}, '+7 days')
              AND c.revoked_by_parent = 0
          )
        WHERE child_id = ${child_id} AND week_start_date = ${weekStart}
      `);
    }

    return { status: 'submitted', locked: bothCommitted };
  });
}
