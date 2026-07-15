import { buildApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Server listening on http://${HOST}:${PORT}`);

    // Start background scheduler
    if (process.env.ENABLE_SCHEDULER === 'true') {
      startScheduler();
      app.log.info('Background scheduler started');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
