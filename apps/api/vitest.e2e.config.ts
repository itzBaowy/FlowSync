import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 15000,
    hookTimeout: 60000,
  },
});
