import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import {
  UserModel,
  RefreshTokenModel,
  decodeCursor,
  createLogger,
  type AdminUpdateUserInput,
  type UpdatePasswordInput,
  type UpdateUserInput,
  type PaginatedResult,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '@storm/shared';
import { encodeCursor } from '@storm/shared';

const logger = createLogger('user-service');
const BCRYPT_ROUNDS = 12;

export interface UserView {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

function toView(user: InstanceType<typeof UserModel>): UserView {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastSeenAt: user.lastSeenAt ?? null,
    createdAt: user.createdAt,
  };
}

// ── Get by ID ─────────────────────────────────────────────────
export async function getUserById(userId: string): Promise<UserView> {
  const user = await UserModel.findOne({ _id: userId, isActive: true });
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
  return toView(user);
}

// ── List users (admin) ────────────────────────────────────────
export async function listUsers(
  cursor?: string,
  limit = PAGINATION_DEFAULT_LIMIT,
): Promise<PaginatedResult<UserView>> {
  const clampedLimit = Math.min(Math.max(1, limit), PAGINATION_MAX_LIMIT);
  const filter: Record<string, unknown> = { isActive: true };

  if (cursor) {
    const { createdAt, _id } = decodeCursor(cursor);
    filter['$or'] = [
      { createdAt: { $lt: new Date(createdAt) } },
      { createdAt: new Date(createdAt), _id: { $lt: new mongoose.Types.ObjectId(_id) } },
    ];
  }

  const users = await UserModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(clampedLimit + 1);

  const hasNextPage = users.length > clampedLimit;
  const items = hasNextPage ? users.slice(0, clampedLimit) : users;
  const last = items[items.length - 1];
  const nextCursor = hasNextPage && last
    ? encodeCursor(last.createdAt, String(last._id))
    : null;

  return {
    items: items.map((u) => ({
      id: String(u._id),
      username: u.username,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastSeenAt: u.lastSeenAt ?? null,
      createdAt: u.createdAt,
    })),
    nextCursor,
    hasNextPage,
  };
}

// ── Update own profile ────────────────────────────────────────
export async function updateUser(userId: string, input: UpdateUserInput): Promise<UserView> {
  if (input.email ?? input.username) {
    const conflict = await UserModel.findOne({
      _id: { $ne: userId },
      $or: [
        ...(input.email ? [{ email: input.email }] : []),
        ...(input.username ? [{ username: input.username }] : []),
      ],
    });
    if (conflict) {
      const field = conflict.email === input.email ? 'email' : 'username';
      throw Object.assign(new Error(`${field} already in use`), { code: 'CONFLICT', field });
    }
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
  logger.info({ userId }, 'User profile updated');
  return toView(user);
}

// ── Change password ───────────────────────────────────────────
export async function updatePassword(userId: string, input: UpdatePasswordInput): Promise<void> {
  const user = await UserModel.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });

  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Current password is incorrect'), { code: 'UNAUTHORIZED' });
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await user.save();
  await RefreshTokenModel.deleteMany({ userId });
  logger.info({ userId }, 'Password changed — all sessions revoked');
}

// ── Admin: update any user ────────────────────────────────────
export async function adminUpdateUser(
  userId: string,
  input: AdminUpdateUserInput,
): Promise<UserView> {
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
  logger.info({ userId }, 'Admin updated user');
  return toView(user);
}

// ── Admin: deactivate user ────────────────────────────────────
export async function deactivateUser(userId: string): Promise<void> {
  const user = await UserModel.findByIdAndUpdate(userId, { $set: { isActive: false } }, { new: true });
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
  await RefreshTokenModel.deleteMany({ userId });
  logger.info({ userId }, 'User deactivated — all sessions revoked');
}