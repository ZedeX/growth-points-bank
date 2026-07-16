import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { createHmac, timingSafeEqual } from 'crypto';

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

/**
 * Verify a JWT token using Node.js native crypto (not jose/Web Crypto API).
 * jose.jwtVerify() was hanging in CI (Node 24 + vitest singleFork mode),
 * causing every authenticated request to time out. This implementation
 * uses createHmac directly and is fully synchronous.
 */
function verifyTokenSync(token: string, secret: Uint8Array): any | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Compute expected signature
  const expectedSig = createHmac('sha256', Buffer.from(secret))
    .update(signingInput)
    .digest('base64url');

  // Timing-safe comparison
  try {
    const a = Buffer.from(signatureB64);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // Decode payload
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function verifyToken(token: string): AuthPayload | null {
  // Try parent secret first
  const parentPayload = verifyTokenSync(token, PARENT_SECRET);
  if (parentPayload && parentPayload.role === 'parent') {
    return { role: 'parent', sub: parentPayload.sub, family_id: parentPayload.family_id };
  }

  // Try child secret
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
    request.auth = verifyToken(token) ?? undefined;
  }
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth) {
    reply.code(401).send({ error: { code: 1001, message: 'Authentication required' } });
  }
}

export function requireParent(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth || request.auth.role !== 'parent') {
    reply.code(403).send({ error: { code: 2001, message: 'Parent access required' } });
  }
}

export function requireChild(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth || request.auth.role !== 'child') {
    reply.code(403).send({ error: { code: 2002, message: 'Child access required' } });
  }
}

export function requireFamilyId(request: FastifyRequest, reply: FastifyReply): string | null {
  if (!request.auth?.family_id) {
    reply.code(401).send({ error: { code: 1001, message: 'Authentication required' } });
    return null;
  }
  return request.auth.family_id;
}
