# Storm

Secure real-time messaging platform built with Node.js, TypeScript, WebSockets, MongoDB, and Redis.

## Architecture

```
nginx  ──►  api:3000       (REST API)
       ──►  gateway:3001   (WebSocket)

api     → mongo, redis
gateway → redis
worker  → mongo, redis
```

See `architecture.md`, `data-models.md`, `api-spec.yaml`, and `websocket-protocol.md` for full design documentation.

---

## Prerequisites

- [Node.js 22+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with WSL2 integration enabled

---

## Local Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd storm
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Then open `.env` and replace all `changeme` / `replace_with_*` values:

```bash
# Generate JWT secret (64 bytes)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate encryption key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start the full stack

```bash
docker compose up --build
```

On first run Docker will pull MongoDB 7, Redis 7, and Node 22 images. Subsequent starts are fast.

### 4. Verify services are healthy

```bash
# REST API health check
curl http://localhost/api/v1/health
# → {"status":"ok"}

# All container statuses
docker compose ps
```

---

## Development (without Docker)

Run services individually against local mongo/redis, or point at the Dockerized infra:

```bash
# Start only infrastructure
docker compose up mongo redis -d

# Run services locally
npm run dev:api
npm run dev:gateway
npm run dev:worker
```

---

## Testing

```bash
# All packages
npm run test

# Single package
npm run test --workspace=packages/api

# With coverage
npm run test:coverage
```

Coverage thresholds: **80% minimum** (blocker), **85% target**.

---

## Linting

```bash
# Lint all packages
npm run lint

# Lint single package
npm run lint --workspace=packages/shared
```

---

## Project Structure

```
storm/
├── packages/
│   ├── shared/      # Types, schemas, utils, crypto — not a service
│   ├── api/         # REST API (port 3000)
│   ├── gateway/     # WebSocket gateway (port 3001)
│   └── worker/      # BullMQ consumer (no HTTP port)
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
├── .env.example
├── tsconfig.base.json
└── package.json
```

---

## Key Environment Variables

| Variable | Description |
|---|---|
| `MONGO_URI` | Full MongoDB connection string |
| `REDIS_URL` | Full Redis connection string |
| `JWT_SECRET` | 64-byte hex secret for signing JWTs |
| `MESSAGE_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM |
| `CORS_ORIGINS` | Comma-separated allowed origins |

See `.env.example` for the full list with generation instructions.

---

## Implementation Progress

See `implementation-plan.md` for the full milestone breakdown.

- [x] Milestone 0 — Project skeleton
- [ ] Milestone 1 — Shared package
- [ ] Milestone 2 — Database layer
- [ ] Milestone 3 — Auth service
- [ ] Milestone 4 — Users & Channels API
- [ ] Milestone 5 — Message REST routes
- [ ] Milestone 6 — WebSocket Gateway
- [ ] Milestone 7 — Worker service
- [ ] Milestone 8 — Hardening
- [ ] Milestone 9 — Test coverage & CI
- [ ] Milestone 10 — Docker Compose production config