import { Redis } from 'ioredis';
import {
  createLogger,
  MessageModel,
  type MessageAckEvent,
} from '@storm/shared';

const logger = createLogger('worker-ack');

export function startAckSubscriber(redisUrl: string): Redis {
  // pub/sub requires a dedicated connection
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

  subscriber.on('error', (err: unknown) => logger.error({ err }, 'Ack subscriber error'));

  void subscriber.psubscribe('channel:*:acks');

  subscriber.on('pmessage', (_pattern: string, _channel: string, message: string) => {
    let event: MessageAckEvent;
    try {
      event = JSON.parse(message) as MessageAckEvent;
    } catch (err) {
      logger.error({ err, message }, 'Failed to parse ack message');
      return;
    }

    MessageModel.updateOne(
      { messageId: event.messageId, deliveryStatus: 'pending' },
      { deliveryStatus: 'delivered' },
    )
      .then(() => logger.debug({ messageId: event.messageId }, 'Ack processed'))
      .catch((err: unknown) => logger.error({ err, messageId: event.messageId }, 'Ack update failed'));
  });

  logger.info('Ack subscriber started');
  return subscriber;
}