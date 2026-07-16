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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
