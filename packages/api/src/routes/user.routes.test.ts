import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo, UserModel, RefreshTokenModel } from '@storm/shared';
import { createApp } from '../app.js';

const TEST_URI = 'mongodb://admin:StormLocal2026!@localhost:27017/storm_users_test?authSource=admin';
const app = createApp();

// ── Helpers ───────────────────────────────────────────────────
async function registerAndLogin(overrides: Record<string, string> = {}) {
  const body = {
    username: overrides['username'] ?? 'testuser',
    email: overrides['email'] ?? 'test@example.com',
    password: overrides['password'] ?? 'Test1234!@',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  return res.body.data as { accessToken: string; refreshToken: string };
}

async function makeAdmin(email: string) {
  await UserModel.updateOne({ email }, { role: 'admin' });
}

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'a'.repeat(128);
  process.env['MESSAGE_ENCRYPTION_KEY'] = 'b'.repeat(64);
  await connectMongo(TEST_URI);
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

// ── GET /users/me ─────────────────────────────────────────────
describe('GET /api/v1/users/me', () => {
  it('returns current user profile', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@example.com');
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /users/me ───────────────────────────────────────────
describe('PATCH /api/v1/users/me', () => {
  it('updates username', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: 'newname' });
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('newname');
  });

  it('returns 409 on duplicate username', async () => {
    await registerAndLogin({ username: 'taken', email: 'taken@example.com' });
    const { accessToken } = await registerAndLogin({ username: 'other', email: 'other@example.com' });
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: 'taken' });
    expect(res.status).toBe(409);
  });

  it('returns 400 on empty body', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── PUT /users/me/password ────────────────────────────────────
describe('PUT /api/v1/users/me/password', () => {
  it('changes password and revokes all sessions', async () => {
    const { accessToken, refreshToken } = await registerAndLogin();
    const res = await request(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'Test1234!@', newPassword: 'NewPass9876#$' });
    expect(res.status).toBe(200);

    // Old refresh token should be revoked
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('returns 401 on wrong current password', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass9876#$' });
    expect(res.status).toBe(401);
  });
});

// ── GET /users/:userId ────────────────────────────────────────
describe('GET /api/v1/users/:userId', () => {
  it('returns a user by ID', async () => {
    const { accessToken } = await registerAndLogin();
    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const userId = (me.body.data as { id: string }).id;

    const res = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(userId);
  });

  it('returns 404 for nonexistent user', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .get('/api/v1/users/000000000000000000000000')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /users (admin) ────────────────────────────────────────
describe('GET /api/v1/users', () => {
  it('returns paginated user list for admin', async () => {
    // Register first user (will be member role)
    await registerAndLogin();

    // Register second user and promote to admin
    await registerAndLogin({ username: 'admin2', email: 'admin2@example.com' });
    await makeAdmin('admin2@example.com');

    // Log in again to get a token that carries the admin role
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin2@example.com', password: 'Test1234!@' });
    const adminToken = (adminLoginRes.body.data as { accessToken: string }).accessToken;

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });
});

// ── DELETE /users/:userId (admin) ─────────────────────────────
describe('DELETE /api/v1/users/:userId', () => {
  it('deactivates a user', async () => {
    // Register target user
    await registerAndLogin({ username: 'target', email: 'target@example.com' });
    const targetRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'target@example.com', password: 'Test1234!@' });
    const targetId = (
      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${(targetRes.body.data as { accessToken: string }).accessToken}`)
    ).body.data.id as string;

    // Register admin
    await registerAndLogin({ username: 'adminuser', email: 'admin@example.com' });
    await makeAdmin('admin@example.com');
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Test1234!@' });
    const adminToken = (adminLoginRes.body.data as { accessToken: string }).accessToken;

    const res = await request(app)
      .delete(`/api/v1/users/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Target user should now be inactive
    const check = await UserModel.findById(targetId);
    expect(check?.isActive).toBe(false);
  });
});