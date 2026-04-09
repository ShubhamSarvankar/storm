# Storm — System Architecture

## 1. Service Boundaries

### API Service (`/api`)
**Owns:** Authentication, user management, channel management, message history retrieval, token lifecycle.

**Does not own:** Real-time message delivery, message persistence after initial write, WebSocket connections, async job processing.

**Responsibilities:**
- Register, login, logout, token refresh
- CRUD for users and channels
- Paginated message history reads from MongoDB
- Enqueuing new messages onto the `message.inbound` BullMQ queue
- Emitting `channel.updated` and `user.updated` pub/sub events when entities change

---

### WebSocket Gateway (`/gateway`)
**Owns:** WebSocket connection lifecycle, presence tracking, real-time event delivery to connected clients, per-connection rate limiting, delivery acknowledgment collection.

**Does not own:** Message persistence, user/channel records, auth token issuance.

**Responsibilities:**
- Authenticating connections via JWT handshake (5-second window)
- Subscribing to Redis pub/sub channels to fan out messages to connected clients
- Tracking online presence in Redis (TTL-based)
- Accepting outbound messages from clients and enqueuing them onto `message.inbound`
- Receiving ack signals from clients and publishing to `message.ack` pub/sub

---

### Worker Service (`/worker`)
**Owns:** Message persistence, delivery guarantees, retry logic, idempotency enforcement.

**Does not own:** HTTP request handling, WebSocket connections, auth.

**Responsibilities:**
- Consuming `message.inbound` BullMQ queue
- Idempotency check before any write (by `messageId`)
- Encrypting message content with AES-256-GCM before persistence
- Writing to MongoDB `messages` collection
- Publishing `message.delivered` event to Redis pub/sub so gateway can forward to clients
- Retry with exponential backoff; dead-letter after `MAX_RETRY_COUNT` exhausted
- Consuming `message.ack` pub/sub and updating delivery status in MongoDB

---

### Shared Package (`/shared`)
Not a running service. Imported by all three services.

**Contains:** TypeScript interfaces and enums, Zod validation schemas, encryption/decryption utilities, Pino logger factory, BullMQ job type definitions, Redis pub/sub channel name constants, JWT utility functions, RBAC role/permission definitions, standard API response builders.

---

## 2. Data Ownership

| Entity | Source of Truth | Service Responsible |
|---|---|---|
| Users | MongoDB `users` | API |
| Channels | MongoDB `channels` | API |
| Messages | MongoDB `messages` | Worker (writes), API (reads) |
| Refresh tokens | MongoDB `refresh_tokens` | API |
| Presence (online/offline) | Redis (TTL keys) | Gateway |
| Delivery status | MongoDB `messages.deliveryStatus` | Worker |
| Job queue state | Redis (BullMQ) | Worker |
| Rate limit counters | Redis | API + Gateway (independently) |

---

## 3. Communication Contracts

### BullMQ Queues

#### `message.inbound`
Produced by: API (REST-submitted messages), Gateway (WebSocket-submitted messages)
Consumed by: Worker

```typescript
interface InboundMessageJob {
  jobId:      string;        // = messageId for idempotency
  messageId:  string;        // client-generated UUIDv4
  channelId:  string;
  senderId:   string;
  content:    string;        // plaintext — worker encrypts before write
  clientTs:   number;        // client-side Unix ms timestamp
  enqueuedAt: number;        // server-side Unix ms timestamp
}
```

#### `message.dead-letter`
Produced by: Worker (after MAX_RETRY_COUNT exhausted)
Consumed by: Worker dead-letter processor (alerts, metrics)

```typescript
interface DeadLetterJob {
  originalJob: InboundMessageJob;
  failureReason: string;
  attempts: number;
  failedAt: number;
}
```

---

### Redis Pub/Sub Channels

#### `channel:{channelId}:messages`
Published by: Worker (after successful persistence)
Subscribed by: Gateway

```typescript
interface DeliveredMessageEvent {
  event:      'message.delivered';
  messageId:  string;
  channelId:  string;
  senderId:   string;
  content:    string;        // plaintext — worker decrypts before publish
  serverTs:   number;        // MongoDB createdAt
}
```

#### `channel:{channelId}:acks`
Published by: Gateway (relaying client acks)
Subscribed by: Worker

```typescript
interface MessageAckEvent {
  event:     'message.ack';
  messageId: string;
  userId:    string;
  ackedAt:   number;
}
```

#### `presence`
Published by: Gateway (on connect/disconnect/heartbeat)
Subscribed by: Gateway instances (for cross-instance presence fan-out)

```typescript
interface PresenceEvent {
  event:    'presence.online' | 'presence.offline';
  userId:   string;
  ts:       number;
}
```

#### `system.channel.updated`
Published by: API (on channel create/update/delete)
Subscribed by: Gateway

```typescript
interface ChannelUpdatedEvent {
  event:     'channel.created' | 'channel.updated' | 'channel.deleted';
  channelId: string;
  ts:        number;
}
```

---

## 4. MongoDB Schema Design

### Collection: `users`
```
_id          ObjectId    PK
username     string      unique, indexed
email        string      unique, indexed
passwordHash string      bcrypt, never logged
role         enum        'admin' | 'moderator' | 'member'
createdAt    Date        indexed
updatedAt    Date
```
Cursor field for pagination: `createdAt` + `_id` (compound)

---

### Collection: `refresh_tokens`
```
_id          ObjectId
userId       ObjectId    ref: users, indexed
tokenHash    string      SHA-256 of raw token, indexed (unique)
expiresAt    Date        TTL index (auto-delete)
createdAt    Date
usedAt       Date|null   null until rotated; once set, token is invalid
```
Note: Raw token is never stored. Only `tokenHash`. TTL index on `expiresAt` for automatic cleanup.

---

### Collection: `channels`
```
_id          ObjectId    PK
name         string      unique, indexed
description  string
createdBy    ObjectId    ref: users
members      ObjectId[]  ref: users, indexed
isArchived   boolean     default false, indexed
createdAt    Date        indexed
updatedAt    Date
```
Compound index: `{ isArchived: 1, createdAt: -1 }` — serves channel list queries.

---

### Collection: `messages`
```
_id             ObjectId
messageId       string      UUIDv4, unique indexed — idempotency key
channelId       ObjectId    ref: channels, indexed
senderId        ObjectId    ref: users
encryptedContent string     AES-256-GCM ciphertext (base64)
iv              string      AES-256-GCM IV (base64), per-message random
authTag         string      AES-256-GCM auth tag (base64)
deliveryStatus  enum        'pending' | 'delivered' | 'failed'
clientTs        Date        client-reported send time
createdAt       Date        server write time
```
Compound index: `{ channelId: 1, createdAt: -1, _id: -1 }` — serves message history with cursor pagination.
Unique index: `{ messageId: 1 }` — idempotency enforcement at DB layer.

---

### Cursor-Based Pagination Strategy
All paginated queries use a compound cursor of `(createdAt, _id)` encoded as a single opaque base64 string.

Decoding yields `{ createdAt: ISOString, _id: string }`. The query becomes:
```
{ channelId, $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }
]}
```
This is stable even if two messages share the same timestamp.

---

## 5. WebSocket Protocol

See `websocket-protocol.md` for the full event reference. Summary of connection lifecycle:

1. Client opens WS connection with `?token=<accessToken>` query param
2. Gateway must verify JWT within **5 seconds** — close with code `4001` on failure or timeout
3. On success, gateway sends `connection.ready` and registers presence
4. Client sends/receives typed events over the live connection
5. On disconnect, gateway clears presence TTL and publishes `presence.offline`

---

## 6. Auth Flow

### JWT Lifecycle
- **Access token:** 15-minute expiry, signed HS256, contains `{ sub: userId, role, jti }`
- **Refresh token:** 7-day expiry, opaque random bytes (32), stored as SHA-256 hash in `refresh_tokens`
- Refresh tokens are **single-use**: on rotation, old token's `usedAt` is set and a new token is issued atomically
- If a used (already-rotated) refresh token is presented again, all refresh tokens for that user are revoked immediately (token reuse detection)

### RBAC Roles
```
admin      — full system access
moderator  — can delete messages, archive channels
member     — default; can send/read in joined channels
```
Permissions are defined in `shared/src/rbac.ts` as an explicit `ROLE_PERMISSIONS` map. No inline role checks anywhere in the codebase — all enforcement through `authorize(role)` middleware.

### WebSocket Auth Handshake
- Access token passed via `?token=` query param on the initial WS upgrade request
- Gateway middleware verifies signature and expiry before the WS handshake completes
- If verification fails or takes > 5 seconds, connection is closed with code `4001 Unauthorized`
- No refresh on the WebSocket connection — client must reconnect with a fresh access token when it expires

---

## 7. Security Baseline

- **Helmet:** Configured on all Express apps
- **CORS:** Explicit allowlist, no wildcard in production
- **Rate limiting:** Redis-backed sliding window — 100 req/hr (public), 1000 req/hr (authenticated), 60 msg/min (WebSocket)
- **Input validation:** Zod schemas from `/shared` applied before any handler logic
- **Encryption:** AES-256-GCM, key from `MESSAGE_ENCRYPTION_KEY` env var (32-byte hex), IV randomly generated per message
- **Password hashing:** bcrypt, cost factor 12
- **Logging:** Pino structured JSON; redaction paths configured for `password`, `token`, `refreshToken`, `content`, `email`
- **OWASP:** Injections prevented by Mongoose typed schemas + Zod; XSS headers via Helmet; CSRF not applicable (JWT, no cookies in default config); SSRF mitigated by no user-supplied URL fetching

---

## 8. Deployment Topology (Docker Compose)

```
nginx  ──►  api:3000       (REST)
       ──►  gateway:3001   (WebSocket upgrade)

api        → mongo, redis
gateway    → redis
worker     → mongo, redis
```

All services share a single Docker Compose network. Only `nginx` exposes ports to the host. MongoDB and Redis are internal-only.
