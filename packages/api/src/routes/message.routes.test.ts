import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  connectMongo,
  disconnectMongo,
  UserModel,
  ChannelModel,
  MessageModel,
  RefreshTokenModel,
} from '@storm/shared';
import { createApp } from '../app.js';

const TEST_URI =
  'mongodb://admin:StormLocal2026!@localhost:27017/storm_messages_test?authSource=admin';
const app = createApp();

// ── Helpers ───────────────────────────────────────────────────
async function registerAndLogin(username = 'testuser', email = 'test@example.com') {
  await request(app).post('/api/v1/auth/register').send({
    username,
    email,
    password: 'Test1234!@',
  });
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test1234!@' });
  return res.body.data as { accessToken: string };
}

async function createChannel(token: string, name = 'general') {
  const res = await request(app)
    .post('/api/v1/channels')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });
  return res.body.data as { id: string };
}

function makeMessage(overrides: Partial<{ messageId: string; content: string; clientTs: string }> = {}) {
  return {
    messageId: overrides.messageId ?? uuidv4(),
    content: overrides.content ?? 'Hello world',
    clientTs: overrides.clientTs ?? new Date().toISOString(),
  };
}

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'a'.repeat(128);
  process.env['MESSAGE_ENCRYPTION_KEY'] = 'b'.repeat(64);
  await connectMongo(TEST_URI);
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await ChannelModel.deleteMany({});
  await MessageModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

// ── POST /channels/:id/messages ───────────────────────────────
describe('POST /api/v1/channels/:channelId/messages', () => {
  it('accepts a message and returns 202 with pending status', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(makeMessage());

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.messageId).toBeTruthy();
  });

  it('returns 202 with duplicate status on repeated messageId', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);
    const msg = makeMessage();

    // First submission — pending
    await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(msg);

    // Seed a message doc to simulate the worker having processed it
    await MessageModel.create({
      messageId: msg.messageId,
      channelId: new mongoose.Types.ObjectId(channelId),
      senderId: new mongoose.Types.ObjectId(),
      encryptedContent: 'fake',
      iv: 'fake',
      authTag: 'fake',
      deliveryStatus: 'delivered',
      clientTs: new Date(),
    });

    // Second submission — duplicate
    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(msg);

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('duplicate');
  });

  it('returns 403 for non-member', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('outsider', 'outsider@example.com');
    const { id: channelId } = await createChannel(t1);

    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${t2}`)
      .send(makeMessage());

    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid payload', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'missing messageId and clientTs' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent channel', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app)
      .post('/api/v1/channels/000000000000000000000000/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(makeMessage());

    expect(res.status).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/v1/channels/000000000000000000000000/messages')
      .send(makeMessage());
    expect(res.status).toBe(401);
  });
});

// ── GET /channels/:id/messages ────────────────────────────────
describe('GET /api/v1/channels/:channelId/messages', () => {
  it('returns empty list when no messages', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    const res = await request(app)
      .get(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(0);
    expect(res.body.meta.hasNextPage).toBe(false);
  });

  it('returns message history with pagination metadata', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    // Seed some messages directly
    const senderId = new mongoose.Types.ObjectId();
    for (let i = 0; i < 3; i++) {
      await MessageModel.create({
        messageId: uuidv4(),
        channelId: new mongoose.Types.ObjectId(channelId),
        senderId,
        encryptedContent: 'fake',
        iv: 'fake',
        authTag: 'fake',
        deliveryStatus: 'delivered',
        clientTs: new Date(),
      });
    }

    const res = await request(app)
      .get(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(3);
    expect(res.body.meta.hasNextPage).toBe(false);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('paginates correctly', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    const senderId = new mongoose.Types.ObjectId();
    for (let i = 0; i < 5; i++) {
      await MessageModel.create({
        messageId: uuidv4(),
        channelId: new mongoose.Types.ObjectId(channelId),
        senderId,
        encryptedContent: 'fake',
        iv: 'fake',
        authTag: 'fake',
        deliveryStatus: 'delivered',
        clientTs: new Date(Date.now() + i * 1000),
      });
    }

    // First page — limit 2
    const page1 = await request(app)
      .get(`/api/v1/channels/${channelId}/messages?limit=2`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(page1.status).toBe(200);
    expect(page1.body.data.messages).toHaveLength(2);
    expect(page1.body.meta.hasNextPage).toBe(true);
    expect(page1.body.meta.nextCursor).toBeTruthy();

    // Second page using cursor
    const page2 = await request(app)
      .get(`/api/v1/channels/${channelId}/messages?limit=2&cursor=${page1.body.meta.nextCursor as string}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(page2.status).toBe(200);
    expect(page2.body.data.messages).toHaveLength(2);

    // No overlap between pages
    const ids1 = (page1.body.data.messages as { id: string }[]).map((m) => m.id);
    const ids2 = (page2.body.data.messages as { id: string }[]).map((m) => m.id);
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
  });

  it('returns 403 for non-member', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('outsider', 'outsider@example.com');
    const { id: channelId } = await createChannel(t1);

    const res = await request(app)
      .get(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${t2}`);

    expect(res.status).toBe(403);
  });
});

// ── DELETE /channels/:id/messages/:messageId ──────────────────
describe('DELETE /api/v1/channels/:channelId/messages/:messageId', () => {
  it('allows sender to delete their own message', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    // Send a message and get the messageId
    const msg = makeMessage();
    await request(app)
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(msg);

    // Seed a doc (worker would normally do this)
    const meRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const senderId = (meRes.body.data as { id: string }).id;

    await MessageModel.create({
      messageId: msg.messageId,
      channelId: new mongoose.Types.ObjectId(channelId),
      senderId: new mongoose.Types.ObjectId(senderId),
      encryptedContent: 'fake',
      iv: 'fake',
      authTag: 'fake',
      deliveryStatus: 'delivered',
      clientTs: new Date(),
    });

    const res = await request(app)
      .delete(`/api/v1/channels/${channelId}/messages/${msg.messageId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(await MessageModel.findOne({ messageId: msg.messageId })).toBeNull();
  });

  it('returns 403 when non-sender member tries to delete', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('member', 'member@example.com');
    const { id: channelId } = await createChannel(t1);

    // Add t2 as member
    const m2Res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${t2}`);
    const m2Id = (m2Res.body.data as { id: string }).id;
    await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ userId: m2Id });

    const msgId = uuidv4();
    const t1Res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${t1}`);
    const t1Id = (t1Res.body.data as { id: string }).id;

    await MessageModel.create({
      messageId: msgId,
      channelId: new mongoose.Types.ObjectId(channelId),
      senderId: new mongoose.Types.ObjectId(t1Id),
      encryptedContent: 'fake',
      iv: 'fake',
      authTag: 'fake',
      deliveryStatus: 'delivered',
      clientTs: new Date(),
    });

    const res = await request(app)
      .delete(`/api/v1/channels/${channelId}/messages/${msgId}`)
      .set('Authorization', `Bearer ${t2}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for nonexistent message', async () => {
    const { accessToken } = await registerAndLogin();
    const { id: channelId } = await createChannel(accessToken);

    const res = await request(app)
      .delete(`/api/v1/channels/${channelId}/messages/${uuidv4()}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});