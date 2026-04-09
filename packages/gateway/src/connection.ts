import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { createLogger, getRedis, redisPresenceKey } from '@storm/shared';
import { verifyConnection } from './auth.js';
import {
  addConnection,
  removeConnection,
  type Connection,
} from './connection-store.js';
import { send } from './sender.js';
import { routeMessage } from './event-router.js';

const logger = createLogger('gateway-connection');

const PRESENCE_TTL = 90; // seconds
const REDIS_OP_TIMEOUT_MS = 2_000;

/** Wrap a Redis promise so it never hangs longer than REDIS_OP_TIMEOUT_MS. */
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Redis timeout')), REDIS_OP_TIMEOUT_MS),
    ),
  ]);
}

async function setPresence(userId: string, sessionId: string, online: boolean): Promise<void> {
  try {
    const redis = getRedis();
    if (online) {
      await withTimeout(
        redis.set(
          redisPresenceKey(userId),
          JSON.stringify({ userId, sessionId, connectedAt: Date.now() }),
          'EX',
          PRESENCE_TTL,
        ),
      );
      await withTimeout(
        redis.publish('presence', JSON.stringify({ event: 'presence.online', userId, ts: Date.now() })),
      );
    } else {
      await withTimeout(redis.del(redisPresenceKey(userId)));
      await withTimeout(
        redis.publish('presence', JSON.stringify({ event: 'presence.offline', userId, ts: Date.now() })),
      );
    }
  } catch {
    //nope lol
  }
}

export async function refreshPresence(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    await withTimeout(redis.expire(redisPresenceKey(userId), PRESENCE_TTL));
  } catch {
    // Non-fatal
  }
}

export async function handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let conn: Connection | undefined;

  try {
    const user = await verifyConnection(ws, req);
    const sessionId = randomUUID();

    conn = {
      ws,
      sessionId,
      user,
      channelIds: new Set(),
      presenceUserIds: new Set(),
      msgCount: 0,
      windowStart: Date.now(),
    };

    addConnection(conn);
    await setPresence(user.sub, sessionId, true);

    send(conn, 'connection.ready', {
      userId: user.sub,
      sessionId,
      serverTs: new Date().toISOString(),
    });

    logger.info({ userId: user.sub, sessionId }, 'Client connected');

    ws.on('message', (data) => {
      void routeMessage(conn!, (data as Buffer).toString());
    });

    ws.on('close', () => {
      const removed = removeConnection(sessionId);
      if (removed) {
        void setPresence(removed.user.sub, sessionId, false);
        logger.info({ userId: removed.user.sub, sessionId }, 'Client disconnected');
      }
    });

    ws.on('error', (err) => {
      logger.error({ err, sessionId }, 'WebSocket error');
    });

  } catch (err) {
    logger.warn({ err }, 'Connection rejected');
  }
}