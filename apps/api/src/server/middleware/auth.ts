import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';

const PARENT_SECRET = process.env.PARENT_JWT_SECRET || 'dev-parent-secret-32-chars-min';
const CHILD_SECRET = process.env.CHILD_JWT_SECRET || 'dev-child-secret-32-chars-min';

export interface AuthPayload {
  role: 'parent' | 'child';
  sub: string;
  family_id: string;
  token_version?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
    authAttempted?: boolean;
  }
}

function signJWT(payload: Record<string, any>, secret: string, expiresInSec: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

export function signParentToken(payload: { sub: string; family_id: string }): string {
  return signJWT({ ...payload, role: 'parent' }, PARENT_SECRET, 7 * 24 * 60 * 60);
}

export function signChildToken(payload: { sub: string; family_id: string; token_version: number }): string {
  return signJWT({ ...payload, role: 'child' }, CHILD_SECRET, 7 * 24 * 60 * 60);
}

function verifyTokenSync(token: string, secret: string): any | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret).update(signingInput).digest('base64url');

  try {
    const a = Buffer.from(signatureB64);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyToken(token: string): AuthPayload | null {
  const parentPayload = verifyTokenSync(token, PARENT_SECRET);
  if (parentPayload && parentPayload.role === 'parent') {
    return { role: 'parent', sub: parentPayload.sub, family_id: parentPayload.family_id };
  }

  const childPayload = verifyTokenSync(token, CHILD_SECRET);
  if (childPayload && childPayload.role === 'child') {
    return {
      role: 'child',
      sub: childPayload.sub,
      family_id: childPayload.family_id,
      token_version: childPayload.token_version,
    };
  }

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
    request.authAttempted = true;
    const payload = verifyToken(token);
    if (payload && payload.role === 'child' && payload.token_version !== undefined) {
      // Verify token_version against database to detect revoked tokens
      const [child] = await db.select({ tokenVersion: schema.children.tokenVersion })
        .from(schema.children)
        .where(eq(schema.children.id, payload.sub))
        .limit(1);
      if (child && child.tokenVersion === payload.token_version) {
        request.auth = payload;
      }
    } else if (payload) {
      request.auth = payload;
    }
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    const code = request.authAttempted ? 401 : 403;
    const errCode = request.authAttempted ? 1001 : 2003;
    reply.code(code).send({ error: { code: errCode, message: 'Authentication required' } });
  }
}

export async function requireParent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth || request.auth.role !== 'parent') {
    reply.code(403).send({ error: { code: 2001, message: 'Parent access required' } });
  }
}

export async function requireChild(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth || request.auth.role !== 'child') {
    reply.code(403).send({ error: { code: 2002, message: 'Child access required' } });
  }
}

export async function requireFamilyId(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  if (!request.auth?.family_id) {
    const code = request.authAttempted ? 401 : 403;
    const errCode = request.authAttempted ? 1001 : 2003;
    reply.code(code).send({ error: { code: errCode, message: 'Authentication required' } });
    return null;
  }
  return request.auth.family_id;
}
