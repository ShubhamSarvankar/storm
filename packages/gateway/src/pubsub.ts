import { Redis } from 'ioredis';
import {
  createLogger,
  PUBSUB_PRESENCE,
  PUBSUB_SYSTEM_CHANNEL_UPDATED,
  type DeliveredMessageEvent,
  type PresenceEvent,
  type ChannelUpdatedEvent,
} from '@storm/shared';
import { getSessionsForChannel } from './connection-store.js';
import { broadcast, sendToUser } from './sender.js';
import { fanOutPresenceChange } from './handlers.js';

const logger = createLogger('gateway-pubsub');

// pub/sub requires a dedicated Redis connection (can't share with commands)
let subscriber: Redis | null = null;

export function startSubscriber(redisUrl: string): void {
  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

  subscriber.on('error', (err: unknown) => logger.error({ err }, 'Subscriber error'));

  // Pattern-subscribe to all channel message and ack channels
  void subscriber.psubscribe('channel:*:messages', 'channel:*:acks');
  void subscriber.subscribe(PUBSUB_PRESENCE, PUBSUB_SYSTEM_CHANNEL_UPDATED);

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      if (channel.endsWith(':messages')) {
        const channelId = channel.replace('channel:', '').replace(':messages', '');
        const event = JSON.parse(message) as DeliveredMessageEvent;
        const conns = getSessionsForChannel(channelId);
        broadcast(conns, 'message.new', {
          messageId: event.messageId,
          channelId: event.channelId,
          senderId: event.senderId,
          content: event.content,
          serverTs: new Date(event.serverTs).toISOString(),
          clientTs: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error({ err, channel }, 'Error handling pmessage');
    }
  });

  subscriber.on('message', (channel: string, message: string) => {
    try {
      if (channel === PUBSUB_PRESENCE) {
        const event = JSON.parse(message) as PresenceEvent;
        fanOutPresenceChange(event.userId, event.event === 'presence.online');
      } else if (channel === PUBSUB_SYSTEM_CHANNEL_UPDATED) {
        const event = JSON.parse(message) as ChannelUpdatedEvent;
        const conns = getSessionsForChannel(event.channelId);
        broadcast(conns, 'channel.updated', {
          channelId: event.channelId,
          change: event.event.replace('channel.', ''),
          ts: new Date(event.ts).toISOString(),
        });
      }
    } catch (err) {
      logger.error({ err, channel }, 'Error handling message');
    }
  });

  logger.info('Redis pub/sub subscriber started');
}

export async function stopSubscriber(): Promise<void> {
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
}