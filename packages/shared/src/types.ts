// ── RBAC ──────────────────────────────────────────────────────
export type Role = 'admin' | 'moderator' | 'member';

export type Permission =
  | 'message:send'
  | 'message:read'
  | 'message:delete:own'
  | 'message:delete:any'
  | 'channel:create'
  | 'channel:read'
  | 'channel:update:own'
  | 'channel:archive'
  | 'channel:delete'
  | 'channel:manage:members'
  | 'user:read'
  | 'user:update:own'
  | 'user:update:any'
  | 'user:deactivate';

// ── Delivery Status ───────────────────────────────────────────
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

// ── JWT Payload ───────────────────────────────────────────────
export interface JwtPayload {
  sub: string;   // userId
  role: Role;
  jti: string;   // unique token ID
  iat: number;
  exp: number;
}

// ── API Response Envelopes ────────────────────────────────────
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  nextCursor?: string | null;
  hasNextPage?: boolean;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

// ── Pagination ────────────────────────────────────────────────
export interface CursorPayload {
  createdAt: string;  // ISO string
  _id: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

// ── BullMQ Job Payloads ───────────────────────────────────────
export interface InboundMessageJob {
  jobId: string;       // = messageId for idempotency
  messageId: string;   // client-generated UUIDv4
  channelId: string;
  senderId: string;
  content: string;     // plaintext — worker encrypts before write
  clientTs: number;    // client-side Unix ms timestamp
  enqueuedAt: number;  // server-side Unix ms timestamp
}

export interface DeadLetterJob {
  originalJob: InboundMessageJob;
  failureReason: string;
  attempts: number;
  failedAt: number;
}

// ── Redis Pub/Sub Event Payloads ──────────────────────────────
export interface DeliveredMessageEvent {
  event: 'message.delivered';
  messageId: string;
  channelId: string;
  senderId: string;
  content: string;   // plaintext — worker decrypts before publish
  serverTs: number;  // MongoDB createdAt as Unix ms
}

export interface MessageAckEvent {
  event: 'message.ack';
  messageId: string;
  userId: string;
  ackedAt: number;
}

export interface PresenceEvent {
  event: 'presence.online' | 'presence.offline';
  userId: string;
  ts: number;
}

export interface ChannelUpdatedEvent {
  event: 'channel.created' | 'channel.updated' | 'channel.deleted';
  channelId: string;
  ts: number;
}

// ── WebSocket Event Envelopes ─────────────────────────────────
export interface WsEvent<T = unknown> {
  event: string;
  payload: T;
  requestId: string;
}

// Client → Server
export interface WsSendMessagePayload {
  messageId: string;
  channelId: string;
  content: string;
  clientTs: string;  // ISO 8601
}

export interface WsPresenceSubscribePayload {
  userIds: string[];
}

// Server → Client
export interface WsConnectionReadyPayload {
  userId: string;
  sessionId: string;
  serverTs: string;
}

export interface WsMessageNewPayload {
  messageId: string;
  channelId: string;
  senderId: string;
  content: string;
  serverTs: string;
  clientTs: string;
}

export interface WsMessageAckPayload {
  messageId: string;
  status: 'queued' | 'duplicate';
  ts: string;
}

export interface WsPresenceUser {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface WsPresenceSnapshotPayload {
  users: WsPresenceUser[];
}

export interface WsPresenceChangedPayload {
  userId: string;
  isOnline: boolean;
  ts: string;
}

export interface WsRateLimitedPayload {
  retryAfter: number;
  limit: number;
  window: 'minute';
}

export interface WsErrorPayload {
  message: string;
  details?: Record<string, unknown>;
}