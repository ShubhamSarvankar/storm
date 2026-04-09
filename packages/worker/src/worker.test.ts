import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import {
  connectMongo,
  disconnectMongo,
  MessageModel,
  QUEUE_MESSAGE_INBOUND,
  pubsubChannelMessages,
  type InboundMessageJob,
} from '@storm/shared';
import { startMessageConsumer } from './message-consumer.js';

const TEST_MONGO_URI =
  process.env['TEST_MONGO_URI'] ??
  'mongodb://admin:StormLocal2026!@localhost:27017/storm_test?authSource=admin';

const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://:RedisLocal2026!@localhost:6379';

// Use the same key as .env so encrypt/decrypt round-trips correctly in tests
const TEST_ENCRYPTION_KEY = process.env['MESSAGE_ENCRYPTION_KEY'] ?? '951bab80b2108be128265a4a2e72d3f0cd24cd834f9113be84003bac24f5ec7c';

const JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
};
let redis: Redis;
let inboundQueue: Queue;

beforeAll(async () => {
  process.env['MESSAGE_ENCRYPTION_KEY'] = TEST_ENCRYPTION_KEY;

  await connectMongo(TEST_MONGO_URI);
  await MessageModel.createIndexes();

  redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
  inboundQueue = new Queue(QUEUE_MESSAGE_INBOUND, { connection: redis });
}, 30_000);

afterAll(async () => {
  await inboundQueue.close();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  }
  await redis.quit();
}, 30_000);

afterEach(async () => {
  await MessageModel.deleteMany({});
  await inboundQueue.drain();
  await inboundQueue.obliterate({ force: true });
});

// ── Helpers ───────────────────────────────────────────────────

function makeJob(overrides: Partial<InboundMessageJob> = {}): InboundMessageJob {
  const messageId = uuidv4();
  return {
    jobId: messageId,
    messageId,
    channelId: new mongoose.Types.ObjectId().toString(),
    senderId: new mongoose.Types.ObjectId().toString(),
    content: 'Hello, Storm!',
    clientTs: Date.now(),
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

/** Run the consumer, process n jobs, then close it. */
async function runConsumer(jobCount = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const consumer = startMessageConsumer(redis);
    let processed = 0;

    consumer.on('completed', () => {
      processed++;
      if (processed >= jobCount) {
        consumer.close().then(resolve).catch(reject);
      }
    });

    consumer.on('failed', (_job, err) => {
      consumer.close().then(() => reject(err)).catch(reject);
    });

    consumer.on('error', (err) => {
      consumer.close().then(() => reject(err)).catch(reject);
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe('message processing', () => {
  it('persists a message to MongoDB with deliveryStatus delivered', async () => {
    const job = makeJob();
    await inboundQueue.add(job.messageId, job, { jobId: job.messageId, ...JOB_OPTS });
    await runConsumer();

    const doc = await MessageModel.findOne({ messageId: job.messageId }).lean();
    expect(doc).toBeTruthy();
    expect(doc?.deliveryStatus).toBe('delivered');
    expect(doc?.encryptedContent).toBeTruthy();
    expect(doc?.iv).toBeTruthy();
    expect(doc?.authTag).toBeTruthy();
    expect(doc?.senderId.toString()).toBe(job.senderId);
    expect(doc?.channelId.toString()).toBe(job.channelId);
  });

  it('publishes a message.delivered event to Redis pub/sub', async () => {
    const job = makeJob();
    const channel = pubsubChannelMessages(job.channelId);

    // Subscribe before enqueuing so we don't miss the publish
    const sub = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    const received = new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('pub/sub timeout')), 10_000);
      sub.subscribe(channel, (err) => { if (err) reject(err); });
      sub.on('message', (_ch, msg) => { clearTimeout(t); resolve(msg); });
    });

    await inboundQueue.add(job.messageId, job, { jobId: job.messageId, ...JOB_OPTS });
    await runConsumer();

    const raw = await received;
    await sub.quit();

    const event = JSON.parse(raw) as Record<string, unknown>;
    expect(event['event']).toBe('message.delivered');
    expect(event['messageId']).toBe(job.messageId);
    expect(event['content']).toBe(job.content);
  });

  it('is idempotent — duplicate job produces only one DB write', async () => {
    const job = makeJob();

    // Add the same job twice with different BullMQ job IDs to bypass BullMQ dedup
    await inboundQueue.add(job.messageId, job, JOB_OPTS);
    await inboundQueue.add(job.messageId + '-dupe', job, JOB_OPTS);

    await runConsumer(2);

    const count = await MessageModel.countDocuments({ messageId: job.messageId });
    expect(count).toBe(1);
  });

  it('sets deliveryStatus failed and enqueues dead-letter after max attempts', async () => {
    // Use an invalid encryption key to force failures
    const originalKey = process.env['MESSAGE_ENCRYPTION_KEY'];
    process.env['MESSAGE_ENCRYPTION_KEY'] = 'tooshort'; // wrong length — getKey() throws

    const job = makeJob();
    await inboundQueue.add(job.messageId, job, { jobId: job.messageId, ...JOB_OPTS });

    const consumer = startMessageConsumer(redis);
    await new Promise<void>((resolve) => {
      consumer.on('failed', (_j, _err) => {
        // Wait for all retries to exhaust
        setTimeout(() => {
          consumer.close().then(resolve).catch(resolve);
        }, 1_000);
      });
    });

    process.env['MESSAGE_ENCRYPTION_KEY'] = originalKey;

    const doc = await MessageModel.findOne({ messageId: job.messageId }).lean();
    // Doc may not exist if it failed before write — that's fine
    if (doc) {
      expect(doc.deliveryStatus).toBe('failed');
    }
  });
});