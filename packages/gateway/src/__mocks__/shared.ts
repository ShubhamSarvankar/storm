type RedisMock = {
  set: () => Promise<void>;
  del: () => Promise<void>;
  expire: () => Promise<void>;
  publish: () => Promise<void>;
  get: () => Promise<null>;
};

// Mock entry point for @storm/shared used during gateway tests.
// Re-exports everything except Mongoose models and Redis, which are stubbed
// to prevent the event loop from hanging when no DB/Redis is running.

export * from '../../../shared/dist/constants.js';
export * from '../../../shared/dist/types.js';
export * from '../../../shared/dist/rbac.js';
export * from '../../../shared/dist/crypto.js';
export * from '../../../shared/dist/pagination.js';
export * from '../../../shared/dist/jwt.js';
export * from '../../../shared/dist/response.js';
export * from '../../../shared/dist/schemas.js';
export { createLogger } from '../../../shared/dist/logger.js';

const noop = (): Promise<void> => Promise.resolve();

export const connectRedis = (): void => undefined;
export const disconnectRedis = noop;
export const getRedis = (): RedisMock => ({
  set: noop,
  del: noop,
  expire: noop,
  publish: noop,
  get: (): Promise<null> => Promise.resolve(null),
});

export const connectMongo = noop;
export const disconnectMongo = noop;
export const UserModel = {};
export const RefreshTokenModel = {};
export const ChannelModel = {};
export const MessageModel = {};