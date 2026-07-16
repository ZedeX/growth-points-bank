import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { requireParent, requireFamilyId } from '../middleware/auth.js';
import { createChild, getChildrenForFamily, getChildById, regenerateChildToken } from '../services/auth.js';
import { createChildSchema } from '@gpb/shared';
import { decryptField } from '../crypto/field-crypto.js';

export async function childrenRoutes(app: FastifyInstance) {
  // List children for family
  app.get('/api/children', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const children = await getChildrenForFamily(familyId);
    return { children };
  });

  // Create child
  app.post('/api/children', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const parsed = createChildSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }
    const child = await createChild(familyId, parsed.data);
    return reply.code(201).send(child);
  });

  // Get child by id
  app.get('/api/children/:id', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    const child = await getChildById(id, familyId);
    if (!child) {
      return reply.code(404).send({ error: { code: 9002, message: 'Child not found' } });
    }
    return child;
  });

  // Regenerate child access token
  app.post('/api/children/:id/regenerate-token', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const { id } = request.params as { id: string };
    try {
      const result = await regenerateChildToken(id, familyId);
      return result;
    } catch {
      return reply.code(404).send({ error: { code: 9002, message: 'Child not found' } });
    }
  });

  // Dimensions
  app.get('/api/dimensions', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const dims = await db.select().from(schema.growthDimensions)
      .where(eq(schema.growthDimensions.familyId, familyId))
      .orderBy(schema.growthDimensions.sortOrder);
    return { dimensions: dims };
  });

  // Create custom dimension
  app.post('/api/dimensions', {
    preHandler: [requireParent],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const familyId = await requireFamilyId(request, reply);
    if (!familyId) return;
    const body = request.body as any;
    const [dim] = await db.insert(schema.growthDimensions).values({
      familyId,
      code: body.code,
      name: body.name,
      color: body.color || '#999999',
      isDefault: false,
      sortOrder: body.sort_order || 99,
    }).returning();
    return reply.code(201).send(dim);
  });
}
