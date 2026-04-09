# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

RUN npm run build --workspace=packages/shared
RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared
RUN npm run build --workspace=packages/api

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

RUN rm -rf /app/node_modules/@storm/shared && \
    ln -s /app/packages/shared/dist /app/node_modules/@storm/shared

EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]