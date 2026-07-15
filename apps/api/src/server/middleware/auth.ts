import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';

const PARENT_SECRET = new TextEncoder().encode(process.env.PARENT_JWT_SECRET || 'dev-parent-secret-32-chars-min');
const CHILD_SECRET = new TextEncoder().encode(process.env.CHILD_JWT_SECRET || 'dev-child-secret-32-chars-min');

export interface AuthPayload {
  role: 'parent' | 'child';
  sub: string;
  family_id: string;
  token_version?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
  }
}

export async function signParentToken(payload: { sub: string; family_id: string }): Promise<string> {
  const jwt = await new jose.SignJWT({ ...payload, role: 'parent' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(PARENT_SECRET);
  return jwt;
}

export async function signChildToken(payload: { sub: string; family_id: string; token_version: number }): Promise<string> {
  const jwt = await new jose.SignJWT({ ...payload, role: 'child' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(CHILD_SECRET);
  return jwt;
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  // Try parent secret first
  try {
    const { payload } = await jose.jwtVerify(token, PARENT_SECRET);
    if (payload.role === 'parent') {
      return { role: 'parent', sub: payload.sub as string, family_id: payload.family_id as string };
    }
  } catch { /* try child next */ }
  // Try child secret
  try {
    const { payload } = await jose.jwtVerify(token, CHILD_SECRET);
    if (payload.role === 'child') {
      return {
        role: 'child',
        sub: payload.sub as string,
        family_id: payload.family_id as string,
        token_version: payload.token_version as number,
      };
    }
  } catch { /* invalid */ }
  return null;
}

export async function authMiddleware(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const cookieToken = (request as any).cookies?.child_session;

  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (token) {
    request.auth = (await verifyToken(token)) ?? undefined;
  }
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth) {
    reply.code(401).send({ error: { code: 1001, message: 'Authentication required' } });
  }
}

export function requireParent(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth || request.auth.role !== 'parent') {
    reply.code(403).send({ error: { code: 1002, message: 'Parent role required' } });
  }
}

export function requireChild(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth || request.auth.role !== 'child') {
    reply.code(403).send({ error: { code: 1002, message: 'Child role required' } });
  }
}

// Re-export multi-tenant helpers for backward compatibility with route imports
export { getFamilyId, requireFamilyId, verifyChildInFamily } from './tenant.js';
