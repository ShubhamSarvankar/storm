import { writeFileSync } from 'fs';
import { connectMongo, connectRedis, createLogger } from '@storm/shared';
import { startMessageConsumer } from './message-consumer.js';
import { startAckSubscriber } from './ack-subscriber.js';

const logger = createLogger('worker');

async function start(): Promise<void> {
  const mongoUri = process.env['MONGO_URI'];
  if (!mongoUri) throw new Error('MONGO_URI is not set');

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('REDIS_URL is not set');

  if (!process.env['MESSAGE_ENCRYPTION_KEY']) {
    throw new Error('MESSAGE_ENCRYPTION_KEY is not set');
  }

  await connectMongo(mongoUri);
  const redis = connectRedis(redisUrl);

  const consumer = startMessageConsumer(redis);
  const ackSub = startAckSubscriber(redisUrl);

  logger.info('Worker service ready');
  writeFileSync('/tmp/worker-healthy', JSON.stringify({ startedAt: new Date().toISOString() }));

  async function shutdown(): Promise<void> {
    logger.info('Worker shutting down');
    await consumer.close();
    await ackSub.quit();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

start().catch((err) => {
  const log = createLogger('worker');
  log.error({ err }, 'Worker failed to start');
  process.exit(1);
});