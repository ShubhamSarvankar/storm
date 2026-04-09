import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
      exclude: [
        'dist/**',
        'vitest.config.ts',
        // Barrel exports — no executable lines
        'src/index.ts',
        'src/index.js',
        'src/db/index.ts',
        // Types-only file
        'src/types.ts',
        // These modules are exercised via API/gateway/worker tests, not shared's own tests
        'src/jwt.ts',
        'src/response.ts',
        'src/schemas.ts',
        'src/db/redis.ts',
        // constants.ts exports are registered as 0-coverage functions by v8
        'src/constants.ts',
        // mongo.ts retry/disconnect paths require a full running stack to test
        'src/db/mongo.ts',
      ],
    },
  },
});