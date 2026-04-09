# Storm — WebSocket Protocol

## Overview

The WebSocket Gateway handles all real-time communication. Clients connect once and exchange typed JSON events over the live connection. The REST API is for auth, history, and management; the WebSocket is for everything that must be live.

**Endpoint:** `ws://localhost/ws` (via nginx upgrade)
**Protocol:** JSON events, no binary frames
**Heartbeat:** Client-initiated ping every 30s; server closes unresponsive connections after 60s

---

## Connection Lifecycle

```
Client                          Gateway                         Redis
  │                               │                               │
  │── WS upgrade ?token=<jwt> ──► │                               │
  │                               │── verify JWT (≤5s) ──────────►│
  │                               │◄─ ok ─────────────────────────│
  │◄── connection.ready ──────────│                               │
  │                               │── SET presence:{userId} ─────►│
  │                               │── PUBLISH presence.online ───►│
  │                               │── SUBSCRIBE channel:{id}:* ──►│
  │                               │                               │
  │  [live session]               │                               │
  │                               │                               │
  │── ping ──────────────────────►│                               │
  │◄── pong ──────────────────────│                               │
  │                               │── EXPIRE presence:{userId} ──►│ (reset TTL)
  │                               │                               │
  │  [client closes / drops]      │                               │
  │                               │── DEL presence:{userId} ─────►│
  │                               │── PUBLISH presence.offline ──►│
  │                               │── UNSUBSCRIBE ───────────────►│
```

### Auth Failure
If JWT verification fails or takes longer than **5 seconds**, the gateway closes the connection:
```
close code : 4001
reason     : "Unauthorized"
```
The client must not attempt to reconnect with the same token. It should refresh the access token via REST and reconnect.

### Token Expiry During Session
The gateway does **not** handle token refresh. When the access token expires mid-session, the connection is not closed immediately (the token was valid at connection time). However, on next reconnect the client must present a fresh token.

---

## Event Format

Every event is a JSON object with at minimum an `event` field and a `payload` field.

```typescript
// All events follow this envelope
interface WsEvent<T = unknown> {
  event:     string;
  payload:   T;
  requestId: string;    // client-provided for client→server; server echoes it back
}
```

---

## Client → Server Events

### `message.send`
Send a new message to a channel.

```typescript
{
  event: 'message.send',
  requestId: string,           // UUID, used in ack
  payload: {
    messageId: string,         // UUIDv4, client-generated idempotency key
    channelId: string,
    content:   string,         // plaintext, max 4000 chars
    clientTs:  string,         // ISO 8601
  }
}
```

Gateway behavior:
1. Validate payload shape; close with `4003 Bad Request` if invalid
2. Check sender is a member of `channelId`; close with `4004 Forbidden` if not
3. Check per-connection rate limit (60 msg/min); if exceeded, send `error.rate_limited` and do **not** close the connection
4. Enqueue onto `message.inbound` BullMQ queue
5. Send `message.ack` back to the sender immediately (status `queued`)

---

### `presence.subscribe`
Ask to receive presence events for a list of users.

```typescript
{
  event: 'presence.subscribe',
  requestId: string,
  payload: {
    userIds: string[]   // max 100
  }
}
```

Gateway responds with `presence.snapshot` immediately, then streams `presence.changed` events as users come online/offline.

---

### `presence.unsubscribe`
Stop receiving presence events for a list of users.

```typescript
{
  event: 'presence.unsubscribe',
  requestId: string,
  payload: {
    userIds: string[]
  }
}
```

---

### `ping`
Keep-alive. Client should send every 30 seconds.

```typescript
{ event: 'ping', requestId: string, payload: {} }
```

---

## Server → Client Events

### `connection.ready`
Sent immediately after successful auth handshake.

```typescript
{
  event: 'connection.ready',
  requestId: '',          // empty — server-initiated
  payload: {
    userId:    string,
    sessionId: string,    // opaque server-assigned session ID for this connection
    serverTs:  string,    // ISO 8601
  }
}
```

---

### `message.new`
Delivered when a new message is persisted and ready. Published by Worker → Redis → Gateway → Client.

```typescript
{
  event: 'message.new',
  requestId: '',
  payload: {
    messageId:  string,
    channelId:  string,
    senderId:   string,
    content:    string,   // plaintext — decrypted by worker before pub/sub
    serverTs:   string,   // ISO 8601, MongoDB createdAt
    clientTs:   string,   // ISO 8601, as provided by sender
  }
}
```

Sent to all connected members of `channelId`, including the original sender (so they can confirm delivery).

---

### `message.ack`
Sent to the **original sender only** to confirm the gateway received their `message.send` event.

```typescript
{
  event: 'message.ack',
  requestId: string,      // echoes requestId from message.send
  payload: {
    messageId: string,
    status:    'queued' | 'duplicate',
    ts:        string,    // ISO 8601
  }
}
```

`duplicate` means the messageId was already seen — no further processing.

---

### `message.deleted`
Broadcast to all connected members of a channel when a message is deleted via REST.

```typescript
{
  event: 'message.deleted',
  requestId: '',
  payload: {
    messageId: string,
    channelId: string,
    deletedBy: string,    // userId
    ts:        string,
  }
}
```

---

### `presence.snapshot`
Response to `presence.subscribe`. Returns current online status for all requested users.

```typescript
{
  event: 'presence.snapshot',
  requestId: string,       // echoes requestId from presence.subscribe
  payload: {
    users: Array<{
      userId:    string,
      isOnline:  boolean,
      lastSeenAt: string | null,   // ISO 8601 or null if never seen
    }>
  }
}
```

---

### `presence.changed`
Streamed to subscribers when a user's presence state changes.

```typescript
{
  event: 'presence.changed',
  requestId: '',
  payload: {
    userId:   string,
    isOnline: boolean,
    ts:       string,
  }
}
```

---

### `channel.updated`
Broadcast to connected members of a channel when its metadata changes (published by API → Redis → Gateway).

```typescript
{
  event: 'channel.updated',
  requestId: '',
  payload: {
    channelId: string,
    change:    'created' | 'updated' | 'deleted' | 'archived',
    ts:        string,
  }
}
```

---

### `error.rate_limited`
Sent when the client exceeds 60 messages/min. The connection is **not** closed.

```typescript
{
  event: 'error.rate_limited',
  requestId: string,       // echoes the triggering requestId
  payload: {
    retryAfter: number,    // seconds
    limit:      60,
    window:     'minute',
  }
}
```

---

### `error.invalid_payload`
Sent when the gateway receives a well-formed JSON frame but with an invalid event shape.

```typescript
{
  event: 'error.invalid_payload',
  requestId: string,
  payload: {
    message: string,
    details: object,       // Zod error details
  }
}
```

---

### `pong`
Response to client `ping`.

```typescript
{ event: 'pong', requestId: string, payload: { serverTs: string } }
```

---

## WebSocket Close Codes

| Code | Meaning | Client Action |
|---|---|---|
| 1000 | Normal closure | None |
| 1001 | Server going down (restart) | Reconnect with backoff |
| 4001 | Unauthorized (auth failed / timeout) | Refresh token, then reconnect |
| 4003 | Bad request (malformed frame) | Fix the payload |
| 4004 | Forbidden (not a channel member) | Do not retry |
| 4008 | Policy violation (persistent abuse) | Do not reconnect |

---

## Delivery Guarantee & Retry Flow

```
Client                  Gateway             BullMQ            Worker
  │                       │                   │                  │
  │── message.send ──────►│                   │                  │
  │◄── message.ack ───────│                   │                  │
  │    (status: queued)   │── enqueue job ───►│                  │
  │                       │                   │── process ──────►│
  │                       │                   │                  │── write to Mongo
  │                       │                   │                  │── PUBLISH channel:*:messages
  │◄── message.new ───────│◄── Redis pub ─────│◄─────────────────│
  │    (to all members)   │                   │                  │
```

### Retry Policy (Worker-side)
```
Attempts : 5
Backoff   : exponential, base 2s, max 30s
On failure: move job to message.dead-letter queue
```

### At-Least-Once Guarantee
The BullMQ job is not removed until the worker confirms successful write to MongoDB. If the worker crashes mid-job, BullMQ re-delivers on the next worker startup.

### Idempotency
The `messageId` unique index on MongoDB ensures that even if a job is re-delivered and processed twice, only one document is written. The second attempt will hit a duplicate key error and exit cleanly (logged, not retried).

---

## Presence in Redis

```
Key pattern : presence:{userId}
Value       : JSON { userId, sessionId, connectedAt }
TTL         : 90 seconds
Refresh     : On every client ping (resets TTL)
On disconnect: Key is immediately deleted (DEL, not TTL expiry)
```

A user is considered online if `presence:{userId}` exists in Redis. Gateway instances stay in sync via the `presence` pub/sub channel.

---

## Reconnection — Client Guidelines

1. On any unexpected close (code ≠ 4001, 4004, 4008), reconnect with exponential backoff: `min(2^attempt * 500ms, 30s)` with ±30% jitter
2. On code `4001`, fetch a new access token via `POST /auth/refresh` first
3. On reconnect, re-subscribe to any channels and re-send `presence.subscribe` — the server holds no per-client subscription state between connections
4. Any `message.send` events queued during disconnect should be replayed using the original `messageId` — idempotency ensures no duplicates
