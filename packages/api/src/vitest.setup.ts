import { vi } from 'vitest';

// Stub Redis so API integration tests don't need a live Redis instance.
// Rate limiters skip in test env (NODE_ENV=test) and channel/message services
// catch Redis errors non-fatally, so a no-op client is sufficient.
// MongoDB is NOT mocked — tests connect to a real test database.
const noop = () => Promise.resolve();

vi.mock('@storm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storm/shared')>();
  return {
    ...actual,
    getRedis: () => ({
      set: noop, del: noop, expire: noop,
      publish: () => Promise.resolve(0),
      get: () => Promise.resolve(null),
      call: () => Promise.resolve(null),
    }),
    connectRedis: () => undefined,
    disconnectRedis: noop,
  };
});