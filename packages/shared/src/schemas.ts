import { z } from 'zod';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from './constants.js';

// ── Primitives ────────────────────────────────────────────────
export const mongoIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId');
export const uuidSchema = z.string().uuid('Must be a valid UUIDv4');

// ── Pagination ────────────────────────────────────────────────
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
});

// ── Auth ──────────────────────────────────────────────────────
export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be at most 32 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  email: z.string().email('Must be a valid email address').transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ── Users ─────────────────────────────────────────────────────
export const updateUserSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const adminUpdateUserSchema = z
  .object({
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
    role: z.enum(['admin', 'moderator', 'member']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// ── Channels ──────────────────────────────────────────────────
export const createChannelSchema = z.object({
  name: z
    .string()
    .min(2, 'Channel name must be at least 2 characters')
    .max(64, 'Channel name must be at most 64 characters'),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
});

export const updateChannelSchema = z
  .object({
    name: z.string().min(2).max(64).optional(),
    description: z.string().max(500).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const addChannelMemberSchema = z.object({
  userId: mongoIdSchema,
});

// ── Messages ──────────────────────────────────────────────────
export const sendMessageSchema = z.object({
  messageId: uuidSchema,
  content: z
    .string()
    .min(1, 'Message content cannot be empty')
    .max(4000, 'Message content must be at most 4000 characters'),
  clientTs: z.string().datetime('clientTs must be a valid ISO 8601 datetime'),
});

// ── WebSocket Event Payloads ──────────────────────────────────
export const wsSendMessageSchema = z.object({
  event: z.literal('message.send'),
  requestId: uuidSchema,
  payload: z.object({
    messageId: uuidSchema,
    channelId: mongoIdSchema,
    content: z.string().min(1).max(4000),
    clientTs: z.string().datetime(),
  }),
});

export const wsPresenceSubscribeSchema = z.object({
  event: z.literal('presence.subscribe'),
  requestId: uuidSchema,
  payload: z.object({
    userIds: z.array(mongoIdSchema).min(1).max(100),
  }),
});

export const wsPresenceUnsubscribeSchema = z.object({
  event: z.literal('presence.unsubscribe'),
  requestId: uuidSchema,
  payload: z.object({
    userIds: z.array(mongoIdSchema).min(1),
  }),
});

export const wsPingSchema = z.object({
  event: z.literal('ping'),
  requestId: uuidSchema,
  payload: z.object({}).passthrough(),
});

// Union of all valid inbound WS events
export const wsInboundEventSchema = z.discriminatedUnion('event', [
  wsSendMessageSchema,
  wsPresenceSubscribeSchema,
  wsPresenceUnsubscribeSchema,
  wsPingSchema,
]);

// ── Inferred Types ────────────────────────────────────────────
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type WsInboundEvent = z.infer<typeof wsInboundEventSchema>;