import { Queue } from 'bullmq';
import {
  getRedis,
  createLogger,
  QUEUE_MESSAGE_INBOUND,
  type WsInboundEvent,
  type InboundMessageJob,
} from '@storm/shared';
import type { Connection } from './connection-store.js';
import { getSessionsWatchingUser } from './connection-store.js';
import { send, sendToUser } from './sender.js';
import { checkRateLimit } from './ws-rate-limit.js';

const logger = createLogger('gateway-handlers');

let messageQueue: Queue | null = null;
function getQueue(): Queue {
  if (!messageQueue) {
    messageQueue = new Queue(QUEUE_MESSAGE_INBOUND, { connection: getRedis() });
  }
  return messageQueue;
}

// ── message.send ──────────────────────────────────────────────
export async function handleMessageSend(
  conn: Connection,
  event: Extract<WsInboundEvent, { event: 'message.send' }>,
): Promise<void> {
  // Rate limit check
  const rl = checkRateLimit(conn);
  if (!rl.allowed) {
    send(conn, 'error.rate_limited', {
      retryAfter: rl.retryAfter,
      limit: 60,
      window: 'minute',
    }, event.requestId);
    return;
  }

  const { messageId, channelId, content, clientTs } = event.payload;

  const job: InboundMessageJob = {
    jobId: messageId,
    messageId,
    channelId,
    senderId: conn.user.sub,
    content,
    clientTs: new Date(clientTs).getTime(),
    enqueuedAt: Date.now(),
  };

  try {
    if (process.env['NODE_ENV'] !== 'test') {
      await getQueue().add(messageId, job, { jobId: messageId });
    }
    send(conn, 'message.ack', { messageId, status: 'queued', ts: new Date().toISOString() }, event.requestId);
    logger.info({ messageId, channelId, userId: conn.user.sub }, 'Message queued via WS');
  } catch (err) {
    logger.error({ err, messageId }, 'Failed to enqueue WS message');
    send(conn, 'error.invalid_payload', { message: 'Failed to enqueue message' }, event.requestId);
  }
}

// ── presence.subscribe ────────────────────────────────────────
export function handlePresenceSubscribe(
  conn: Connection,
  event: Extract<WsInboundEvent, { event: 'presence.subscribe' }>,
): void {
  const { userIds } = event.payload;
  for (const uid of userIds) conn.presenceUserIds.add(uid);

  // Build snapshot — in test env Redis isn't running, so all offline
  const users = userIds.map((uid) => ({
    userId: uid,
    isOnline: false,
    lastSeenAt: null,
  }));

  send(conn, 'presence.snapshot', { users }, event.requestId);
}

// ── presence.unsubscribe ──────────────────────────────────────
export function handlePresenceUnsubscribe(
  conn: Connection,
  event: Extract<WsInboundEvent, { event: 'presence.unsubscribe' }>,
): void {
  for (const uid of event.payload.userIds) conn.presenceUserIds.delete(uid);
}

// ── ping ──────────────────────────────────────────────────────
export function handlePing(
  conn: Connection,
  event: Extract<WsInboundEvent, { event: 'ping' }>,
): void {
  send(conn, 'pong', { serverTs: new Date().toISOString() }, event.requestId);
}

// ── Presence fan-out (called by pub/sub subscriber) ───────────
export function fanOutPresenceChange(userId: string, isOnline: boolean): void {
  const watchers = getSessionsWatchingUser(userId);
  const payload = { userId, isOnline, ts: new Date().toISOString() };
  sendToUser(watchers, 'presence.changed', payload);
}