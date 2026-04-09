# Storm — Data Models

## Design Decisions

- **Embed vs. reference:** Channel membership is a flat `ObjectId[]` on the channel document. This is acceptable because membership lists are read on every auth check and channel load, and Storm doesn't target channels with tens of thousands of members. If that changes, a dedicated `memberships` collection is the migration path.
- **Encrypted fields:** Only message content is encrypted at rest. Metadata (sender, channel, timestamps) is stored plaintext — this is a deliberate trade-off for queryability. Encryption keys live in environment variables only.
- **No soft deletes by default:** Users and messages use hard deletes. Channels have `isArchived` because channel history must remain readable after a channel is closed.
- **Timestamps:** All documents use `createdAt` / `updatedAt`. Mongoose `timestamps: true` option is used everywhere.

---

## Collections

### `users`

| Field | Type | Required | Unique | Indexed | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✓ | ✓ | ✓ | Auto |
| `username` | string | ✓ | ✓ | ✓ | 3–32 chars, alphanumeric + underscore |
| `email` | string | ✓ | ✓ | ✓ | Lowercase normalized on write |
| `passwordHash` | string | ✓ | — | — | bcrypt cost 12; never logged or returned |
| `role` | enum | ✓ | — | — | `'admin' \| 'moderator' \| 'member'`; default `'member'` |
| `isActive` | boolean | ✓ | — | ✓ | default `true`; set `false` on deactivation instead of delete |
| `lastSeenAt` | Date | — | — | — | Updated by gateway on disconnect |
| `createdAt` | Date | ✓ | — | ✓ | Part of cursor |
| `updatedAt` | Date | ✓ | — | — | |

**Indexes:**
```
{ username: 1 }              unique
{ email: 1 }                 unique
{ isActive: 1, createdAt: -1, _id: -1 }   compound — user list pagination
```

**Cursor field:** `(createdAt, _id)` descending — most recently created first.

**Encrypted fields:** None. Email is PII but not encrypted at rest in this version; treat as a known limitation.

---

### `refresh_tokens`

| Field | Type | Required | Unique | Indexed | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✓ | ✓ | ✓ | Auto |
| `userId` | ObjectId | ✓ | — | ✓ | ref: `users` |
| `tokenHash` | string | ✓ | ✓ | ✓ | SHA-256 of the raw token (hex) |
| `expiresAt` | Date | ✓ | — | ✓ | TTL index — MongoDB auto-deletes expired docs |
| `usedAt` | Date\|null | ✓ | — | — | `null` until rotated; non-null = invalid |
| `createdAt` | Date | ✓ | — | — | |

**Indexes:**
```
{ tokenHash: 1 }             unique — lookup on refresh
{ userId: 1 }                — revoke all tokens for a user
{ expiresAt: 1 }             TTL index, expireAfterSeconds: 0
```

**Reuse detection:** If a token with non-null `usedAt` is presented, delete all documents where `userId` matches — full session revocation.

---

### `channels`

| Field | Type | Required | Unique | Indexed | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✓ | ✓ | ✓ | Auto |
| `name` | string | ✓ | ✓ | ✓ | 2–64 chars; slugified |
| `description` | string | — | — | — | Max 500 chars |
| `createdBy` | ObjectId | ✓ | — | — | ref: `users` |
| `members` | ObjectId[] | ✓ | — | ✓ | ref: `users`; default includes `createdBy` |
| `isArchived` | boolean | ✓ | — | ✓ | default `false` |
| `createdAt` | Date | ✓ | — | ✓ | Part of cursor |
| `updatedAt` | Date | ✓ | — | — | |

**Indexes:**
```
{ name: 1 }                                unique
{ members: 1 }                             — "channels I belong to" query
{ isArchived: 1, createdAt: -1, _id: -1 }  compound — channel list pagination
```

**Cursor field:** `(createdAt, _id)` descending.

---

### `messages`

| Field | Type | Required | Unique | Indexed | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✓ | ✓ | ✓ | Auto |
| `messageId` | string | ✓ | ✓ | ✓ | UUIDv4, client-generated; idempotency key |
| `channelId` | ObjectId | ✓ | — | ✓ | ref: `channels`; part of compound index |
| `senderId` | ObjectId | ✓ | — | — | ref: `users` |
| `encryptedContent` | string | ✓ | — | — | AES-256-GCM ciphertext, base64 |
| `iv` | string | ✓ | — | — | 12-byte random IV, base64; unique per message |
| `authTag` | string | ✓ | — | — | 16-byte GCM auth tag, base64 |
| `deliveryStatus` | enum | ✓ | — | ✓ | `'pending' \| 'delivered' \| 'failed'`; default `'pending'` |
| `clientTs` | Date | ✓ | — | — | Client-reported send time; display only, not trusted for ordering |
| `createdAt` | Date | ✓ | — | ✓ | Server write time; source of truth for ordering |
| `updatedAt` | Date | ✓ | — | — | |

**Indexes:**
```
{ messageId: 1 }                                  unique — idempotency enforcement
{ channelId: 1, createdAt: -1, _id: -1 }          compound — message history pagination (primary)
{ channelId: 1, deliveryStatus: 1 }               compound — pending/failed message reprocessing
{ senderId: 1, createdAt: -1 }                    compound — "messages by user" admin queries
```

**Cursor field:** `(createdAt, _id)` descending — newest first. Compound cursor handles same-timestamp collisions.

**Encrypted fields:** `encryptedContent`, `iv`, `authTag`. The worker encrypts before write and decrypts before publishing to pub/sub. The API never decrypts — it only returns the raw ciphertext if a "export my data" flow is ever added.

---

## Cursor Pagination — Reference Implementation

All paginated collections use the same cursor strategy. Below is the canonical implementation in pseudocode; the actual typed implementation lives in `shared/src/pagination.ts`.

```
// Encoding
cursor = base64(JSON.stringify({ createdAt: doc.createdAt.toISOString(), _id: doc._id.toString() }))

// Decoding + query construction
{ createdAt, _id } = JSON.parse(base64decode(cursor))

filter = {
  ...baseFilter,
  $or: [
    { createdAt: { $lt: new Date(createdAt) } },
    { createdAt: new Date(createdAt), _id: { $lt: new ObjectId(_id) } }
  ]
}

sort  = { createdAt: -1, _id: -1 }
limit = requestedLimit + 1   // fetch one extra to determine hasNextPage

// Response
hasNextPage = results.length > requestedLimit
items       = results.slice(0, requestedLimit)
nextCursor  = hasNextPage ? encode(items[items.length - 1]) : null
```

**Default page size:** 50. **Maximum page size:** 100. Enforced by Zod on the query param schema.

---

## Encryption — Field-Level Detail

Only `messages.encryptedContent` is encrypted. The worker service owns all encrypt/decrypt operations.

```
Algorithm : AES-256-GCM
Key source : MESSAGE_ENCRYPTION_KEY env var (32-byte hex string → 256-bit key)
IV         : 12 bytes, crypto.randomBytes(12) per message — NEVER reused
Auth tag   : 16 bytes, produced by GCM mode; stored in messages.authTag
Storage    : encryptedContent = base64(ciphertext), iv = base64(iv), authTag = base64(authTag)
```

The encryption utility in `shared/src/crypto.ts` exports `encryptMessage(plaintext)` and `decryptMessage({ encryptedContent, iv, authTag })`. These are the only two functions that touch the key. They are unit-tested in isolation before any other code uses them.

---

## Relationship Diagram

```
users ──────────────────────────────────────────┐
  │ createdBy                                    │ members[]
  ▼                                              ▼
channels ◄──────────── messages.channelId    channels
                            │
                    messages.senderId
                            │
                            ▼
                          users

refresh_tokens.userId ──► users
```
