import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo, UserModel, RefreshTokenModel } from '@storm/shared';
import { createApp } from '../app.js';

const TEST_URI = 'mongodb://admin:StormLocal2026!@localhost:27017/storm_auth_test?authSource=admin';

const app = createApp();

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'a'.repeat(128); // 64 bytes hex
  process.env['MESSAGE_ENCRYPTION_KEY'] = 'b'.repeat(64); // 32 bytes hex
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

// ── Helpers ───────────────────────────────────────────────────
const validUser = {
  username: 'testuser',
  email: 'test@example.com',
  password: 'Test1234!@',
};

async function registerUser(overrides = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ ...validUser, ...overrides });
}

// ── Register ─────────────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {
  it('creates a user and returns tokens', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.expiresIn).toBe(900);
  });

  it('returns 409 on duplicate email', async () => {
    await registerUser();
    const res = await registerUser({ username: 'other' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 409 on duplicate username', async () => {
    await registerUser();
    const res = await registerUser({ email: 'other@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 on invalid email', async () => {
    const res = await registerUser({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on weak password', async () => {
    const res = await registerUser({ password: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});
    expect(res.status).toBe(400);
  });
});

// ── Login ─────────────────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {
  beforeAll(async () => {
    await registerUser();
  });

  it('returns tokens on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });

  it('returns 401 on unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: validUser.password });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

// ── Refresh ───────────────────────────────────────────────────
describe('POST /api/v1/auth/refresh', () => {
  it('returns new tokens on valid refresh token', async () => {
    const reg = await registerUser();
    const { refreshToken } = reg.body.data as { refreshToken: string };

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).not.toBe(refreshToken); // rotated
  });

  it('returns 401 on invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('detects token reuse and returns 401', async () => {
    const reg = await registerUser();
    const { refreshToken } = reg.body.data as { refreshToken: string };

    // Use the token once
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

    // Use it again — should trigger reuse detection
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // All refresh tokens for this user should now be revoked
    const reg2 = await registerUser({ username: 'user2', email: 'user2@example.com' });
    const count = await RefreshTokenModel.countDocuments({});
    // Only the new user's token should remain
    expect(count).toBe(1);
    expect(reg2.status).toBe(201);
  });
});

// ── Logout ────────────────────────────────────────────────────
describe('POST /api/v1/auth/logout', () => {
  it('revokes the refresh token', async () => {
    const reg = await registerUser();
    const { accessToken, refreshToken } = reg.body.data as {
      accessToken: string;
      refreshToken: string;
    };

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(res.status).toBe(200);

    // Token should now be gone
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'anything' });
    expect(res.status).toBe(401);
  });
});