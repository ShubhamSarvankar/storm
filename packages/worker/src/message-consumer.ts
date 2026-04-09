import { Worker, Queue, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  createLogger,
  encryptMessage,
  decryptMessage,
  MessageModel,
  QUEUE_MESSAGE_INBOUND,
  QUEUE_MESSAGE_DEAD_LETTER,
  pubsubChannelMessages,
  type InboundMessageJob,
  type DeadLetterJob,
  type DeliveredMessageEvent,
} from '@storm/shared';

const logger = createLogger('worker-consumer');

const MAX_ATTEMPTS = 5;

export function startMessageConsumer(redis: Redis): Worker {
  const deadLetterQueue = new Queue(QUEUE_MESSAGE_DEAD_LETTER, { connection: redis });

  const worker = new Worker<InboundMessageJob>(
    QUEUE_MESSAGE_INBOUND,
    async (job: Job<InboundMessageJob>) => {
      const { messageId, channelId, senderId, content, clientTs } = job.data;
      logger.debug({ messageId, channelId }, 'Processing inbound message');

      // 1. Idempotency check
      const existing = await MessageModel.findOne({ messageId }).lean();
      if (existing) {
        logger.info({ messageId }, 'Duplicate job — skipping');
        return;
      }

      // 2. Encrypt
      const { encryptedContent, iv, authTag } = encryptMessage(content);

      // 3. Write to MongoDB
      const doc = await MessageModel.create({
        messageId,
        channelId,
        senderId,
        encryptedContent,
        iv,
        authTag,
        deliveryStatus: 'pending',
        clientTs: new Date(clientTs),
      });

      logger.debug({ messageId }, 'Message persisted');

      // 4. Decrypt and publish to pub/sub
      const plaintext = decryptMessage({ encryptedContent, iv, authTag });
      const event: DeliveredMessageEvent = {
        event: 'message.delivered',
        messageId,
        channelId,
        senderId,
        content: plaintext,
        serverTs: doc.createdAt.getTime(),
      };
      await redis.publish(pubsubChannelMessages(channelId), JSON.stringify(event));

      // 5. Update delivery status
      await MessageModel.updateOne({ messageId }, { deliveryStatus: 'delivered' });
      logger.info({ messageId, channelId }, 'Message delivered');
    },
    {
      connection: redis,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const isExhausted = (job.attemptsMade ?? 0) >= MAX_ATTEMPTS;
    if (!isExhausted) return;

    logger.error({ messageId: job.data.messageId, err }, 'Job exhausted — dead-lettering');

    const deadLetter: DeadLetterJob = {
      originalJob: job.data,
      failureReason: err.message,
      attempts: job.attemptsMade ?? MAX_ATTEMPTS,
      failedAt: Date.now(),
    };

    void deadLetterQueue.add(job.data.messageId, deadLetter);
    void MessageModel.updateOne(
      { messageId: job.data.messageId },
      { deliveryStatus: 'failed' },
    ).catch(() => undefined);
  });

  worker.on('error', (err) => logger.error({ err }, 'Worker error'));

  logger.info('Message consumer started');
  return worker;
}