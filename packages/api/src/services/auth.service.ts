import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import {
  UserModel,
  RefreshTokenModel,
  signJwt,
  createLogger,
  type RegisterInput,
  type LoginInput,
} from '@storm/shared';

const logger = createLogger('auth-service');

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_SECONDS = 15 * 60;        // 15 minutes
const REFRESH_TOKEN_SECONDS = 7 * 24 * 3600; // 7 days
const REFRESH_TOKEN_BYTES = 32;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ── Register ──────────────────────────────────────────────────
export async function register(input: RegisterInput): Promise<AuthTokens> {
  const existing = await UserModel.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  });
  if (existing) {
    const field = existing.email === input.email ? 'email' : 'username';
    throw Object.assign(new Error(`${field} already in use`), { code: 'CONFLICT', field });
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await UserModel.create({
    username: input.username,
    email: input.email,
    passwordHash,
    role: 'member',
    isActive: true,
  });

  logger.info({ userId: user._id.toString() }, 'User registered');
  return issueTokens(user._id.toString(), user.role);
}

// ── Login ─────────────────────────────────────────────────────
export async function login(input: LoginInput): Promise<AuthTokens> {
  const user = await UserModel.findOne({ email: input.email, isActive: true });

  // Always run bcrypt to prevent timing-based user enumeration
  const hash = user?.passwordHash ?? '$2b$12$invalidhashfortimingprotection000000000000000';
  const valid = await bcrypt.compare(input.password, hash);

  if (!user || !valid) {
    throw Object.assign(new Error('Invalid email or password'), { code: 'UNAUTHORIZED' });
  }

  logger.info({ userId: user._id.toString() }, 'User logged in');
  return issueTokens(user._id.toString(), user.role);
}

// ── Refresh ───────────────────────────────────────────────────
export async function refresh(rawToken: string): Promise<AuthTokens> {
  const tokenHash = hashToken(rawToken);
  const stored = await RefreshTokenModel.findOne({ tokenHash });

  if (!stored || stored.expiresAt < new Date()) {
    throw Object.assign(new Error('Refresh token invalid or expired'), { code: 'UNAUTHORIZED' });
  }

  // Token reuse detection — if already used, revoke all tokens for this user
  if (stored.usedAt !== null) {
    logger.warn({ userId: stored.userId.toString() }, 'Refresh token reuse detected — revoking all sessions');
    await RefreshTokenModel.deleteMany({ userId: stored.userId });
    throw Object.assign(new Error('Token reuse detected'), { code: 'TOKEN_REUSE_DETECTED' });
  }

  // Mark old token as used (single-use enforcement)
  stored.usedAt = new Date();
  await stored.save();

  const user = await UserModel.findById(stored.userId);
  if (!user || !user.isActive) {
    throw Object.assign(new Error('User not found or inactive'), { code: 'UNAUTHORIZED' });
  }

  logger.info({ userId: user._id.toString() }, 'Tokens rotated');
  return issueTokens(user._id.toString(), user.role);
}

// ── Logout ────────────────────────────────────────────────────
export async function logout(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await RefreshTokenModel.deleteOne({ tokenHash });
}

// ── Helpers ───────────────────────────────────────────────────
async function issueTokens(userId: string, role: string): Promise<AuthTokens> {
  const accessToken = signJwt(userId, role as Parameters<typeof signJwt>[1], {
    expiresInSeconds: ACCESS_TOKEN_SECONDS,
  });

  const rawRefresh = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);

  await RefreshTokenModel.create({ userId, tokenHash, expiresAt, usedAt: null });

  return { accessToken, refreshToken: rawRefresh, expiresIn: ACCESS_TOKEN_SECONDS };
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}