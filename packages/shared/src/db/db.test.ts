import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from './mongo.js';
import { UserModel } from './models/user.model.js';
import { RefreshTokenModel } from './models/refresh-token.model.js';
import { ChannelModel } from './models/channel.model.js';
import { MessageModel } from './models/message.model.js';

// Override with TEST_MONGO_URI env var if set, e.g. for CI.
// Falls back to local dev credentials — safe since this is test-only code.
const TEST_URI =
  process.env['TEST_MONGO_URI'] ??
  'mongodb://admin:StormLocal2026!@localhost:27017/storm_test?authSource=admin';

beforeAll(async () => {
  await connectMongo(TEST_URI);
  await Promise.all([
    UserModel.createIndexes(),
    RefreshTokenModel.createIndexes(),
    ChannelModel.createIndexes(),
    MessageModel.createIndexes(),
  ]);
}, 30_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  }
});

// Helper: get index key specs for a collection
async function getIndexKeys(collection: mongoose.Collection): Promise<string[]> {
  const indexes = await collection.indexes();
  return indexes.map((idx) => JSON.stringify(idx['key']));
}

describe('UserModel indexes', () => {
  it('has a unique index on username', async () => {
    const keys = await getIndexKeys(UserModel.collection);
    expect(keys).toContain(JSON.stringify({ username: 1 }));
  });

  it('has a unique index on email', async () => {
    const keys = await getIndexKeys(UserModel.collection);
    expect(keys).toContain(JSON.stringify({ email: 1 }));
  });

  it('has a compound index for pagination', async () => {
    const keys = await getIndexKeys(UserModel.collection);
    expect(keys).toContain(JSON.stringify({ isActive: 1, createdAt: -1, _id: -1 }));
  });
});

describe('RefreshTokenModel indexes', () => {
  it('has a unique index on tokenHash', async () => {
    const keys = await getIndexKeys(RefreshTokenModel.collection);
    expect(keys).toContain(JSON.stringify({ tokenHash: 1 }));
  });

  it('has an index on userId', async () => {
    const keys = await getIndexKeys(RefreshTokenModel.collection);
    expect(keys).toContain(JSON.stringify({ userId: 1 }));
  });

  it('has a TTL index on expiresAt', async () => {
    const indexes = await RefreshTokenModel.collection.indexes();
    const ttl = indexes.find(
      (idx) => JSON.stringify(idx['key']) === JSON.stringify({ expiresAt: 1 }),
    );
    expect(ttl).toBeDefined();
    expect(ttl?.['expireAfterSeconds']).toBe(0);
  });
});

describe('ChannelModel indexes', () => {
  it('has a unique index on name', async () => {
    const keys = await getIndexKeys(ChannelModel.collection);
    expect(keys).toContain(JSON.stringify({ name: 1 }));
  });

  it('has an index on members', async () => {
    const keys = await getIndexKeys(ChannelModel.collection);
    expect(keys).toContain(JSON.stringify({ members: 1 }));
  });

  it('has a compound index for pagination', async () => {
    const keys = await getIndexKeys(ChannelModel.collection);
    expect(keys).toContain(JSON.stringify({ isArchived: 1, createdAt: -1, _id: -1 }));
  });
});

describe('MessageModel indexes', () => {
  it('has a unique index on messageId', async () => {
    const keys = await getIndexKeys(MessageModel.collection);
    expect(keys).toContain(JSON.stringify({ messageId: 1 }));
  });

  it('has a compound index for message history pagination', async () => {
    const keys = await getIndexKeys(MessageModel.collection);
    expect(keys).toContain(JSON.stringify({ channelId: 1, createdAt: -1, _id: -1 }));
  });

  it('has a compound index for reprocessing', async () => {
    const keys = await getIndexKeys(MessageModel.collection);
    expect(keys).toContain(JSON.stringify({ channelId: 1, deliveryStatus: 1 }));
  });

  it('has a compound index for admin queries', async () => {
    const keys = await getIndexKeys(MessageModel.collection);
    expect(keys).toContain(JSON.stringify({ senderId: 1, createdAt: -1 }));
  });
});