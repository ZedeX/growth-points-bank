import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registerParent, loginParent, createChild, getChildByToken } from '../services/auth.js';
import { signChildToken } from '../middleware/auth.js';
import { registerSchema, loginSchema } from '@gpb/shared';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }
    try {
      const result = await registerParent(parsed.data);
      return reply.code(201).send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: { code: 9003, message: err.message || 'Registration failed' } });
    }
  });

  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 9001, message: parsed.error.message } });
    }
    try {
      const result = await loginParent(parsed.data.email_or_phone, parsed.data.password);
      return reply.send(result);
    } catch (err: any) {
      return reply.code(401).send({ error: { code: err.code || 1003, message: err.message || 'Login failed' } });
    }
  });

  // Child link redemption: GET /api/child/auth?token=<access_token>
  app.get('/api/child/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.code(400).send({ error: { code: 9001, message: 'Token required' } });
    }

    const child = await getChildByToken(token);
    if (!child) {
      return reply.code(401).send({ error: { code: 1004, message: 'Invalid or expired token' } });
    }

    const jwt = await signChildToken({
      sub: child.id,
      family_id: child.familyId,
      token_version: child.tokenVersion,
    });

    reply.setCookie('child_session', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return { token: jwt, child: { id: child.id, familyId: child.familyId } };
  });
}
