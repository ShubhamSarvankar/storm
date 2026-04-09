import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo, UserModel, ChannelModel, RefreshTokenModel } from '@storm/shared';
import { createApp } from '../app.js';

const TEST_URI = 'mongodb://admin:StormLocal2026!@localhost:27017/storm_channels_test?authSource=admin';
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
    .send({ name, description: 'A test channel' });
  return res;
}

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'a'.repeat(128);
  process.env['MESSAGE_ENCRYPTION_KEY'] = 'b'.repeat(64);
  await connectMongo(TEST_URI);
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await ChannelModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

// ── POST /channels ────────────────────────────────────────────
describe('POST /api/v1/channels', () => {
  it('creates a channel and adds creator as member', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await createChannel(accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('general');
    expect(res.body.data.members).toHaveLength(1);
  });

  it('returns 409 on duplicate channel name', async () => {
    const { accessToken } = await registerAndLogin();
    await createChannel(accessToken);
    const res = await createChannel(accessToken);
    expect(res.status).toBe(409);
  });

  it('returns 400 on missing name', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/v1/channels')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/v1/channels').send({ name: 'test' });
    expect(res.status).toBe(401);
  });
});

// ── GET /channels ─────────────────────────────────────────────
describe('GET /api/v1/channels', () => {
  it('returns only channels the user belongs to', async () => {
    const { accessToken: t1 } = await registerAndLogin('user1', 'user1@example.com');
    const { accessToken: t2 } = await registerAndLogin('user2', 'user2@example.com');
    await createChannel(t1, 'channel-a');
    await createChannel(t2, 'channel-b');

    const res = await request(app)
      .get('/api/v1/channels')
      .set('Authorization', `Bearer ${t1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.channels).toHaveLength(1);
    expect(res.body.data.channels[0].name).toBe('channel-a');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/channels');
    expect(res.status).toBe(401);
  });
});

// ── GET /channels/:channelId ──────────────────────────────────
describe('GET /api/v1/channels/:channelId', () => {
  it('returns channel for a member', async () => {
    const { accessToken } = await registerAndLogin();
    const created = await createChannel(accessToken);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .get(`/api/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(channelId);
  });

  it('returns 403 for non-member', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('other', 'other@example.com');
    const created = await createChannel(t1);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .get(`/api/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${t2}`);
    expect(res.status).toBe(403);
  });
});

// ── PATCH /channels/:channelId ────────────────────────────────
describe('PATCH /api/v1/channels/:channelId', () => {
  it('updates channel name', async () => {
    const { accessToken } = await registerAndLogin();
    const created = await createChannel(accessToken);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .patch(`/api/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('renamed');
  });

  it('returns 403 when member tries to archive', async () => {
    const { accessToken } = await registerAndLogin();
    const created = await createChannel(accessToken);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .patch(`/api/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isArchived: true });
    expect(res.status).toBe(403);
  });

  it('returns 403 for non-member', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('other', 'other@example.com');
    const created = await createChannel(t1);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .patch(`/api/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${t2}`)
      .send({ name: 'hacked' });
    expect(res.status).toBe(403);
  });
});

// ── Members ───────────────────────────────────────────────────
describe('Channel member management', () => {
  it('adds a member to a channel', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('joiner', 'joiner@example.com');

    const meRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${t2}`);
    const joinerId = (meRes.body.data as { id: string }).id;

    const created = await createChannel(t1);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ userId: joinerId });
    expect(res.status).toBe(200);
    expect(res.body.data.members).toContain(joinerId);
  });

  it('returns 409 when adding an existing member', async () => {
    const { accessToken } = await registerAndLogin();
    const meRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const myId = (meRes.body.data as { id: string }).id;

    const created = await createChannel(accessToken);
    const channelId = (created.body.data as { id: string }).id;

    const res = await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: myId });
    expect(res.status).toBe(409);
  });

  it('allows a member to remove themselves', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('member', 'member@example.com');

    const meRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${t2}`);
    const memberId = (meRes.body.data as { id: string }).id;

    const created = await createChannel(t1);
    const channelId = (created.body.data as { id: string }).id;

    await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ userId: memberId });

    const res = await request(app)
      .delete(`/api/v1/channels/${channelId}/members/${memberId}`)
      .set('Authorization', `Bearer ${t2}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 when member tries to remove another member', async () => {
    const { accessToken: t1 } = await registerAndLogin('owner', 'owner@example.com');
    const { accessToken: t2 } = await registerAndLogin('mem1user', 'mem1@example.com');
    const { accessToken: t3 } = await registerAndLogin('mem2user', 'mem2@example.com');

    const m1Res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${t2}`);
    const m2Res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${t3}`);
    const m1Id = (m1Res.body.data as { id: string }).id;
    const m2Id = (m2Res.body.data as { id: string }).id;

    const created = await createChannel(t1);
    const channelId = (created.body.data as { id: string }).id;

    await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ userId: m1Id });
    await request(app)
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ userId: m2Id });

    // m1 tries to remove m2 — should be 403
    const res = await request(app)
      .delete(`/api/v1/channels/${channelId}/members/${m2Id}`)
      .set('Authorization', `Bearer ${t2}`);
    expect(res.status).toBe(403);
  });
});