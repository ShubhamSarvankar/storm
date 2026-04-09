import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type SendCommandFn, type RedisReply } from 'rate-limit-redis';
import { getRedis, buildError, ERROR_CODES } from '@storm/shared';
import type { Request, Response } from 'express';

function rateLimitErrorHandler(_req: Request, res: Response): void {
  res.status(429).json(buildError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many requests'));
}

// Lazily create the RedisStore on first use so Redis doesn't need to be
// connected at import time (important for test environments).
function makeLazyStore(prefix: string): Options['store'] {
  let store: RedisStore | null = null;

  const sendCommand: SendCommandFn = (...args: string[]) => {
    const redis = getRedis();
    return redis.call(...(args as [string, ...string[]])) as Promise<RedisReply>;
  };

  return {
    async increment(key) {
      store ??= new RedisStore({ sendCommand, prefix });
      return store.increment(key);
    },
    async decrement(key) {
      store ??= new RedisStore({ sendCommand, prefix });
      return store.decrement(key);
    },
    async resetKey(key) {
      store ??= new RedisStore({ sendCommand, prefix });
      return store.resetKey(key);
    },
  };
}

// 100 requests/hr for unauthenticated routes
export const publicRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env['RATE_LIMIT_PUBLIC_MAX'] ?? '100', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeLazyStore('rl:public:'),
  handler: rateLimitErrorHandler,
  skip: () => process.env['NODE_ENV'] === 'test',
});

// 1000 requests/hr for authenticated routes
export const authRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env['RATE_LIMIT_AUTHED_MAX'] ?? '1000', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.sub ?? req.ip ?? 'unknown',
  store: makeLazyStore('rl:authed:'),
  handler: rateLimitErrorHandler,
  skip: () => process.env['NODE_ENV'] === 'test',
});