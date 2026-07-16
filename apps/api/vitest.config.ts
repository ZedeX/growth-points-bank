import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../packages/shared/src'),
      '@server': resolve(__dirname, 'src/server'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // All test files share a single database pool (module-level singleton
    // in src/server/db/client.ts) and a single Fastify app instance per
    // file. Running files in parallel causes TRUNCATE-vs-INSERT lock
    // contention and cross-file data cleanup, which manifests as every
    // beforeEach hook timing out. Force serial execution.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        // Run all test files in a single fork so the db pool singleton
        // is shared exactly once across the whole suite.
        singleFork: true,
      },
    },
    // CI runners are slower; give hooks and tests reasonable room.
    hookTimeout: 30_000,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
