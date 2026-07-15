import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ status: 'healthy', timestamp: new Date().toISOString() }));
  app.get('/api/ready', async () => {
    try {
      // Simple DB connectivity check
      const { db } = await import('../db/client.js');
      await db.execute(sql`SELECT 1`);
      return { status: 'ready' };
    } catch {
      return { status: 'not_ready' };
    }
  });
}
