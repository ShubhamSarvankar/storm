# Storm

A production-grade real-time messaging platform built from scratch in TypeScript. Features end-to-end encrypted messaging, JWT authentication with refresh token rotation, role-based access control, WebSocket presence tracking, and a fully automated HTTPS Docker deployment.

**112 tests · 0 vulnerabilities · 4 services · AES-256-GCM encryption · single-command boot**

---

## What This Demonstrates

- **Distributed systems** — three stateless services communicating exclusively through Redis pub/sub and BullMQ; no direct service-to-service HTTP
- **Security engineering** — AES-256-GCM message encryption, single-use JWT refresh tokens with replay attack detection, RBAC middleware, rate limiting, PII redaction in logs
- **Reliability patterns** — idempotent message writes enforced at the DB layer, BullMQ retry with exponential backoff and dead-letter queue, cursor-based pagination with collision-safe compound cursors
- **Production readiness** — multi-stage Docker builds, self-signed TLS auto-generated on first boot, no secrets in images, resource limits per service, graceful shutdown with forced exit timeout
- **Test discipline** — 90%+ line coverage across all packages, integration tests against real MongoDB and Redis, every message write proven idempotent

---

## Architecture

Storm is three independent services that communicate exclusively through Redis pub/sub and BullMQ — no direct HTTP calls between services.

```
Client
  │
  ▼
nginx (TLS termination)
  ├──► api:3000      REST — auth, users, channels, message history
  └──► gateway:3001  WebSocket — real-time delivery, presence

api     ──► MongoDB, Redis
gateway ──► Redis
worker  ──► MongoDB, Redis (BullMQ consumer)
```

**Message flow:** Client sends → API enqueues to BullMQ → Worker encrypts and persists to MongoDB → Worker publishes to Redis pub/sub → Gateway fans out to connected clients.

**Why this separation?** The gateway holds no state beyond active connections. The worker owns all write guarantees. The API never touches message content after enqueue. Each service can fail and recover independently.

---

## Technical Highlights

**Security**
- AES-256-GCM encryption for all message content at rest — IV randomly generated per message, never reused
- JWT authentication with HS256, 15-minute access tokens, 7-day single-use refresh tokens with rotation and reuse detection (full session revocation on replay attack)
- RBAC with three roles (`admin`, `moderator`, `member`) enforced through a single `authorize()` middleware — no inline role checks anywhere
- Rate limiting via Redis sliding window: 100 req/hr public, 1000 req/hr authenticated, 60 msg/min per WebSocket connection
- Helmet, CORS allowlist, structured Pino logging with PII redaction — passwords, tokens, and message content never appear in logs

**Reliability**
- All message writes are idempotent via a client-generated `messageId` UUID enforced at the database layer with a unique index
- BullMQ retry policy: 5 attempts with exponential backoff, dead-letter queue after exhaustion
- Cursor-based pagination everywhere — `(createdAt, _id)` compound cursor handles same-timestamp collisions correctly
- Graceful shutdown in all services with forced exit timeout

**Production deployment**
- Multi-stage Docker builds — source and dev dependencies never reach runtime images
- Self-signed TLS cert auto-generated on first boot via an init container — `docker compose up` is the only command needed
- MongoDB and Redis ports not exposed to the host in production
- Resource limits defined per service

---

## Test Coverage

112 tests across all packages. All integration tests run against real MongoDB and Redis — nothing is mocked at the infrastructure layer.

| Package | Lines | Branches | Functions |
|---|---|---|---|
| shared | 99.44% | 99.04% | 91.66% |
| gateway | 90.82% | 89.15% | 82.35% |
| worker | 93.29% | 80.64% | 100% |
| api | 90.29% | 86.25% | 81.03% |

Every message write has a test proving duplicate submission is a no-op.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript strict mode |
| API | Express 5 |
| WebSocket | `ws` library |
| Database | MongoDB 7 + Mongoose |
| Queue / Cache | Redis 7 + BullMQ |
| Auth | Hand-rolled HS256 JWT (no library dependency) |
| Encryption | AES-256-GCM via Node.js `crypto` |
| Testing | Vitest 4 + Supertest |
| Logging | Pino (structured JSON) |
| Containers | Docker + Docker Compose |

---

## Getting Started

### Prerequisites

- [Node.js 22+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Compose v2

### 1. Clone and install

```bash
git clone <repo-url>
cd storm
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Generate the required secrets:

```bash
# JWT secret (64 bytes)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Encryption key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Replace the `changeme` and `replace_with_*` placeholders in `.env` with real values.

### 3. Start — development

```bash
docker compose up --build
```

API available at `http://localhost/api/v1`. WebSocket at `ws://localhost/ws`.

### 4. Start — production (HTTPS)

```bash
docker compose -f docker-compose.prod.yml up --build
```

A self-signed TLS certificate is generated automatically on first boot. API available at `https://localhost/api/v1`. WebSocket at `wss://localhost/ws`.

### 5. Verify

```bash
curl http://localhost/api/v1/health
# → {"status":"ok"}
```

---

## Running Tests

```bash
# All packages
npm test

# Single package
npm test --workspace=packages/api

# With coverage report
npm run test:coverage --workspace=packages/api
```

---

## Linting

```bash
npm run lint --workspace=packages/api
npm run lint --workspace=packages/gateway
npm run lint --workspace=packages/worker
npm run lint --workspace=packages/shared
```

---

## Project Structure

```
storm/
├── packages/
│   ├── shared/      # Types, Zod schemas, crypto utils, JWT, pagination — not a service
│   ├── api/         # REST API (port 3000)
│   ├── gateway/     # WebSocket gateway (port 3001)
│   └── worker/      # BullMQ consumer — message persistence and delivery
├── nginx/
│   ├── nginx.conf         # Development
│   └── nginx.prod.conf    # Production (TLS)
├── docs/
│   ├── architecture.md
│   ├── data-models.md
│   ├── api-spec.txt
│   └── websocket-protocol.md
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

---

## Design Decisions

**No Socket.io** — the `ws` library is used directly. Socket.io adds significant overhead and abstractions that aren't needed when you control both ends of the protocol.

**Hand-rolled JWT** — the JWT implementation uses Node's built-in `crypto` module with no external dependency. The format is standard HS256; the goal was to avoid supply-chain risk on a security-critical component while keeping the implementation auditable (< 100 lines).

**Worker owns encryption** — message content is encrypted before the MongoDB write and decrypted before the Redis pub/sub publish. The API and gateway never see plaintext content. This means a compromised API process cannot read message history.

**Embed vs. reference for channel membership** — channel members are stored as an `ObjectId[]` on the channel document rather than a separate collection. This makes membership checks on every auth and channel load a single document read. The trade-off is that channels with very large member counts would need a dedicated `memberships` collection — acceptable for the current scale target.