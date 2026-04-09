# Storm — Implementation Plan

Reference this document at the start of every coding session. Mark milestones complete as you go. Each milestone should pass lint + tests before moving to the next.

---

## Milestone 0 — Project Skeleton
*Goal: `docker compose up` starts all services with no errors. Zero business logic yet.*

- [ ] Initialize monorepo with npm workspaces (`/api`, `/gateway`, `/worker`, `/shared`)
- [ ] TypeScript `strict` mode config in each package and at root
- [ ] ESLint + Prettier configured, enforced in all packages
- [ ] Vitest configured per service with coverage thresholds (80% blocker, 85% target)
- [ ] `docker-compose.yml` — all services, MongoDB 7, Redis 7, nginx
- [ ] Nginx config — routes `/api/*` to api service, `/ws` upgrade to gateway
- [ ] `.env.example` with all required variables documented
- [ ] Each service starts, logs a ready message (Pino), and responds to its health check
- [ ] `README.md` — how to run locally, env setup, test commands

---

## Milestone 1 — Shared Package
*Goal: All shared infrastructure is available and tested before any service uses it.*

- [ ] TypeScript interfaces: `User`, `Channel`, `Message`, `InboundMessageJob`, `DeadLetterJob`, all WS event shapes
- [ ] Zod schemas for all API request bodies (aligned with `api-spec.yaml`)
- [ ] Zod schemas for all WS event payloads
- [ ] `encryptMessage` / `decryptMessage` AES-256-GCM utility — **unit tested in isolation**
- [ ] `buildCursor` / `parseCursor` pagination utility — unit tested
- [ ] Pino logger factory with redaction paths (`password`, `token`, `refreshToken`, `content`, `email`)
- [ ] `buildSuccess` / `buildError` API response builders
- [ ] RBAC: `ROLE_PERMISSIONS` map, `hasPermission(role, action)` utility — unit tested
- [ ] BullMQ queue name constants and Redis pub/sub channel name constants
- [ ] JWT sign/verify utilities wrapping chosen library

---

## Milestone 2 — Database Layer
*Goal: MongoDB connections and Mongoose models exist, indexes are created, connections work in tests.*

- [ ] MongoDB connection module (shared pattern, used by API and Worker)
- [ ] Mongoose schema: `users` — fields, indexes, no passwordHash in `toJSON`
- [ ] Mongoose schema: `refresh_tokens` — fields, TTL index
- [ ] Mongoose schema: `channels` — fields, indexes
- [ ] Mongoose schema: `messages` — fields, unique messageId index, compound index
- [ ] Redis connection module (shared pattern, used by all three services)
- [ ] Test: all indexes exist after model load (integration test, real MongoDB)

---

## Milestone 3 — Auth Service
*Goal: Register, login, logout, and token refresh work end-to-end. RBAC middleware exists.*

- [ ] `POST /auth/register` — bcrypt hash, issue tokens, return `AuthTokens`
- [ ] `POST /auth/login` — verify hash, issue tokens
- [ ] `POST /auth/refresh` — single-use rotation, reuse detection (full revocation)
- [ ] `POST /auth/logout` — revoke token
- [ ] `authenticate` middleware — verifies JWT, attaches `req.user`
- [ ] `authorize(role)` middleware — checks `ROLE_PERMISSIONS`, returns 403 if insufficient
- [ ] Rate limiter middleware — Redis sliding window, 100/hr public, 1000/hr authenticated, 429 + Retry-After
- [ ] Helmet + CORS configured on Express app
- [ ] Integration tests: all four auth routes (real MongoDB + Redis)
- [ ] Unit tests: token rotation logic, reuse detection, RBAC permission checks

---

## Milestone 4 — Users & Channels API
*Goal: Full CRUD for users and channels, all routes protected and tested.*

- [ ] `GET /users` (admin), `GET /users/me`, `PATCH /users/me`, `PUT /users/me/password`
- [ ] `GET /users/:userId`, `PATCH /users/:userId` (admin), `DELETE /users/:userId` (admin)
- [ ] `GET /channels`, `POST /channels`
- [ ] `GET /channels/:id`, `PATCH /channels/:id`, `DELETE /channels/:id`
- [ ] `POST /channels/:id/members`, `DELETE /channels/:id/members/:userId`
- [ ] Membership check middleware — used by channel routes, re-used by message routes
- [ ] `system.channel.updated` Redis pub/sub publish on channel create/update/delete
- [ ] Integration tests: all routes — auth, authorization, 404s, conflicts, pagination
- [ ] Cursor pagination tested: first page, subsequent page, empty last page

---

## Milestone 5 — Message REST Routes
*Goal: Send and retrieve message history. Worker not running yet — messages stay `pending`.*

- [ ] `GET /channels/:id/messages` — cursor-paginated history (metadata only, no content)
- [ ] `POST /channels/:id/messages` — validate, enqueue to `message.inbound`, return 202
- [ ] `DELETE /channels/:id/messages/:messageId` — sender or admin/moderator
- [ ] Idempotency: duplicate `messageId` POST returns 202 with `status: duplicate`
- [ ] Integration tests: all message routes
- [ ] Test: duplicate messageId submission is a no-op (idempotency test)

---

## Milestone 6 — WebSocket Gateway
*Goal: Clients can connect, auth, send messages, and receive real-time delivery.*

- [ ] WS server setup with `ws` library; connection handler
- [ ] Auth handshake — JWT from query param, 5-second timeout, close `4001` on failure
- [ ] Presence registration on connect, cleanup on disconnect
- [ ] Event router — dispatches incoming frames to typed handlers
- [ ] `message.send` handler — validate, membership check, rate limit, enqueue, send ack
- [ ] `presence.subscribe` / `presence.unsubscribe` handlers
- [ ] `ping` / `pong` handler — resets presence TTL
- [ ] Redis pub/sub subscription: `channel:{id}:messages` → forward `message.new` to members
- [ ] Redis pub/sub subscription: `system.channel.updated` → forward `channel.updated` to members
- [ ] Redis pub/sub subscription: `presence` pub/sub → fan out `presence.changed` to subscribers
- [ ] Per-connection rate limiting: 60 msg/min, send `error.rate_limited` (do not close)
- [ ] Integration tests: connection + auth handshake, auth timeout, send + receive message.new, rate limit
- [ ] Test: unauthenticated connection closes within 5 seconds with code 4001

---

## Milestone 7 — Worker Service
*Goal: Messages are encrypted, persisted, and delivered. Retry and dead-letter logic works.*

- [ ] BullMQ consumer for `message.inbound`
- [ ] Idempotency check — query MongoDB by `messageId` before write; exit cleanly on duplicate
- [ ] Encrypt content with AES-256-GCM before write
- [ ] Write to `messages` collection with `deliveryStatus: 'pending'`
- [ ] Decrypt and publish `message.delivered` to `channel:{channelId}:messages` pub/sub
- [ ] Update `deliveryStatus` to `'delivered'` after successful publish
- [ ] Retry policy: 5 attempts, exponential backoff base 2s, max 30s
- [ ] Dead-letter handler: enqueue to `message.dead-letter`, update status to `'failed'`, log
- [ ] `message.ack` pub/sub consumer — update delivery status
- [ ] Integration tests: full message flow (API enqueue → Worker persist → Gateway deliver)
- [ ] Test: duplicate job (same messageId) processed twice — only one DB write
- [ ] Test: failed job retried and eventually dead-lettered after max attempts

---

## Milestone 8 — Hardening
*Goal: Production-ready error handling, logging, and security posture.*

- [ ] Global error handler in API — catches unhandled errors, returns standard error envelope, never leaks stack traces
- [ ] Structured Pino logging audit — confirm no PII, tokens, or message content in any log line
- [ ] Request ID propagation — generated in middleware, attached to all response metas and log entries
- [ ] MongoDB connection retry logic with backoff
- [ ] Redis connection retry logic with backoff
- [ ] Graceful shutdown in all services — drain in-flight requests, close DB connections
- [ ] Input length limits enforced at nginx level (client_max_body_size)
- [ ] All Zod validation errors produce consistent 400 responses (no schema internals leaked)
- [ ] OWASP review pass: injection, broken auth, sensitive data, security misconfiguration

---

## Milestone 9 — Test Coverage & CI
*Goal: 85%+ line coverage across all services. Everything passes in a clean environment.*

- [ ] Run coverage reports per service; fix any service below 80% before proceeding
- [ ] Reach 85%+ line coverage across all services
- [ ] All integration tests run against real MongoDB + Redis (no mocks)
- [ ] CI pipeline (GitHub Actions or equivalent): lint → unit tests → integration tests → coverage check
- [ ] Test database seeding/teardown is reliable and isolated between test runs

---

## Milestone 10 — Docker Compose Production Config
*Goal: System runs correctly as a multi-container stack with all services wired together.*

- [ ] Production `docker-compose.yml` (separate from dev, no volume mounts for source)
- [ ] All services use environment variable injection (no hardcoded values)
- [ ] Health checks defined for all services in Compose
- [ ] Nginx TLS termination config (self-signed cert acceptable for local production-like testing)
- [ ] Resource limits defined per service
- [ ] `docker compose up` from scratch: all services healthy, all integration tests pass against running stack

---

## Reference

| Doc | Purpose |
|---|---|
| `architecture.md` | Service boundaries, communication contracts, auth flow |
| `data-models.md` | Collections, fields, indexes, encryption, pagination |
| `api-spec.yaml` | All REST routes, request/response shapes, error codes |
| `websocket-protocol.md` | All WS events, lifecycle, close codes, retry flow |
| `implementation-plan.md` | This file |
