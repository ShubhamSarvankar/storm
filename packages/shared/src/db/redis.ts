import { Redis } from 'ioredis';
import { createLogger } from '../logger.js';

const logger = createLogger('redis');

let client: Redis | null = null;

export function connectRedis(url?: string): Redis {
  if (client) return client;

  const redisUrl = url ?? process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  client = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(2_000 * 2 ** (times - 1), 30_000);
      logger.warn({ times, delay }, 'Redis connection retry...');
      return delay;
    },
    reconnectOnError: (err: Error) => {
      logger.error({ err }, 'Redis reconnect on error');
      return true;
    },
  });

  client.on('connect', () => logger.info('Redis connected'));
  client.on('ready', () => logger.info('Redis ready'));
  client.on('error', (err: unknown) => logger.error({ err }, 'Redis error'));
  client.on('close', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  return client;
}

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialised — call connectRedis() first');
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
  logger.info('Redis disconnected cleanly');
}