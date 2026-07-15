import type { FastifyRequest, FastifyReply } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';

// Multi-tenant isolation: ensures every query filters by family_id (ADR-0006)
// Cross-family access returns 404 (not 403, to prevent resource enumeration)

export function getFamilyId(request: FastifyRequest): string | null {
  return request.auth?.family_id ?? null;
}

export function requireFamilyId(request: FastifyRequest, reply: FastifyReply): string | null {
  const familyId = getFamilyId(request);
  if (!familyId) {
    reply.code(401).send({ error: { code: 1001, message: 'No family context' } });
    return null;
  }
  return familyId;
}

// Verify a child belongs to the authenticated family
export async function verifyChildInFamily(childId: string, familyId: string): Promise<boolean> {
  const [child] = await db.select({ id: schema.children.id })
    .from(schema.children)
    .where(and(eq(schema.children.id, childId), eq(schema.children.familyId, familyId)))
    .limit(1);
  return !!child;
}
