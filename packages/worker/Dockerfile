# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/worker ./packages/worker

RUN npm run build --workspace=packages/shared
RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared
RUN npm run build --workspace=packages/worker

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist

RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared

CMD ["node", "packages/worker/dist/index.js"]