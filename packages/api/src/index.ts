import http from 'http';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo, connectRedis, disconnectRedis, createLogger } from '@storm/shared';

const PORT = process.env['PORT'] ?? '3000';
const logger = createLogger('api');

async function start(): Promise<void> {
  await connectMongo();
  connectRedis();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'API service ready');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'API shutting down');
    server.close(async () => {
      try {
        await disconnectMongo();
        await disconnectRedis();
        logger.info('API shutdown complete');
      } catch (err) {
        logger.error({ err }, 'Error during API shutdown');
      } finally {
        process.exit(0);
      }
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err }, 'API failed to start');
  process.exit(1);
});

export default createApp;