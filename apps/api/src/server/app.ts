import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { childrenRoutes } from './routes/children.js';
import { taskRoutes } from './routes/tasks.js';
import { checkinRoutes } from './routes/checkins.js';
import { rewardRoutes } from './routes/rewards.js';
import { reviewRoutes } from './routes/reviews.js';
import { diaryRoutes } from './routes/diaries.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info'
        : process.env.NODE_ENV === 'test' ? 'silent'
        : 'debug',
    },
  });

  // Plugins
  await app.register(helmet, {
    contentSecurityPolicy: false,  // disable for dev; enable in production
  });
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });
  await app.register(cookie, {
    secret: process.env.CHILD_JWT_SECRET || 'dev-cookie-secret',
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth middleware - runs on every request
  app.addHook('preHandler', authMiddleware);

  // Error handler
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as any).code;
    if (typeof code === 'number') {
      const status = code >= 1000 && code < 2000 ? 401
        : code >= 2000 && code < 3000 ? 403
        : code >= 3000 && code < 5000 ? 400
        : code >= 9000 ? 400
        : 500;
      return reply.code(status).send({ error: { code, message: error.message } });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: 9003, message: 'Internal server error' } });
  });

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(childrenRoutes);
  await app.register(taskRoutes);
  await app.register(checkinRoutes);
  await app.register(rewardRoutes);
  await app.register(reviewRoutes);
  await app.register(diaryRoutes);

  return app;
}
