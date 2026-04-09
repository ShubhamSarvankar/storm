# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/gateway ./packages/gateway

# Build shared first, then manually link its dist so TS can resolve it
RUN npm run build --workspace=packages/shared

# Symlink shared dist into node_modules so gateway's tsc can find it
RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared

RUN npm run build --workspace=packages/gateway

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist

# Link shared for runtime resolution
RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared

EXPOSE 3001
CMD ["node", "packages/gateway/dist/index.js"]