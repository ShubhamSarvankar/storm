import http from 'http';
import { WebSocketServer } from 'ws';
import { connectRedis, disconnectRedis, createLogger } from '@storm/shared';
import { handleConnection } from './connection.js';
import { startSubscriber, stopSubscriber } from './pubsub.js';

const PORT = process.env['PORT'] ?? '3001';
const logger = createLogger('gateway');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Upgrade Required');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  void handleConnection(ws, req);
});

async function start(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('REDIS_URL is not set');

  connectRedis(redisUrl);
  startSubscriber(redisUrl);

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'Gateway service ready');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Gateway shutting down');

    wss.close(async () => {
      server.close(async () => {
        try {
          await stopSubscriber();
          await disconnectRedis();
          logger.info('Gateway shutdown complete');
        } catch (err) {
          logger.error({ err }, 'Error during gateway shutdown');
        } finally {
          process.exit(0);
        }
      });
    });

    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err }, 'Gateway failed to start');
  process.exit(1);
});