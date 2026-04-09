// ── BullMQ Queue Names ────────────────────────────────────────
export const QUEUE_MESSAGE_INBOUND = 'message.inbound';
export const QUEUE_MESSAGE_DEAD_LETTER = 'message.dead-letter';

// ── Redis Pub/Sub Channel Helpers ─────────────────────────────
export const pubsubChannelMessages = (channelId: string): string =>
  `channel:${channelId}:messages`;

export const pubsubChannelAcks = (channelId: string): string =>
  `channel:${channelId}:acks`;

export const PUBSUB_PRESENCE = 'presence';
export const PUBSUB_SYSTEM_CHANNEL_UPDATED = 'system.channel.updated';

// ── Redis Key Helpers ─────────────────────────────────────────
export const redisPresenceKey = (userId: string): string =>
  `presence:${userId}`;

export const redisRateLimitKey = (identifier: string): string =>
  `ratelimit:${identifier}`;

// ── Pagination ────────────────────────────────────────────────
export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 100;

// ── Auth ──────────────────────────────────────────────────────
export const JWT_ALGORITHM = 'HS256' as const;
export const REFRESH_TOKEN_BYTES = 32;
export const PRESENCE_TTL_SECONDS = 90;

// ── Worker ────────────────────────────────────────────────────
export const MAX_RETRY_COUNT = 5;
export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 30_000;

// ── WebSocket Close Codes ─────────────────────────────────────
export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_GOING_AWAY = 1001;
export const WS_CLOSE_UNAUTHORIZED = 4001;
export const WS_CLOSE_BAD_REQUEST = 4003;
export const WS_CLOSE_FORBIDDEN = 4004;
export const WS_CLOSE_POLICY_VIOLATION = 4008;

// ── Rate Limits ───────────────────────────────────────────────
export const RATE_LIMIT_WS_MSG_MAX = 60;
export const RATE_LIMIT_WS_WINDOW_MS = 60_000;