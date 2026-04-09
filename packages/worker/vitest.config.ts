import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 60,  // worker.on('failed') and worker.on('error') handlers
        branches: 50,   // not reachable without forcing BullMQ internal failures
      },
      exclude: [
        'dist/**',
        'vitest.config.ts',
        'vitest.config.js',
        // Entry point and ack subscriber require a full running stack
        'src/index.ts',
        'src/ack-subscriber.ts',
      ],
    },
  },
});