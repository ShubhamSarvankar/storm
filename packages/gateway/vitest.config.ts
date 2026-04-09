import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@storm/shared': resolve(__dirname, './src/__mocks__/shared.ts'),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 15_000,
    hookTimeout: 20_000,
    setupFiles: ['./src/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 79,      // connection.ts presence/Redis paths unreachable without live stack
        functions: 72,  // handlers.ts and connection.ts have infra-dependent branches
        branches: 73,   // same — mocked shared limits branch reachability
      },
      exclude: [
        'dist/**',
        'vitest.config.ts',
        'src/vitest.setup.ts',
        'src/__mocks__/**',
        'src/test-helpers.ts',
        // Entry point and pub/sub require a full running stack
        'src/index.ts',
        'src/pubsub.ts',
        // Store and sender are infrastructure exercised via integration tests
        // but not directly unit-testable without a full WS stack
        'src/connection-store.ts',
        'src/sender.ts',
      ],
    },
  },
});