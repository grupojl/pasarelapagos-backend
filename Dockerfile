# =============================================================================
# pasarela-pagos — Dockerfile
# =============================================================================

# ── Stage 1: instalar dependencias ───────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

COPY package.json pnpm-lock.yaml ./

COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma       ./prisma

COPY package.json pnpm-lock.yaml nest-cli.json tsconfig.json ./
COPY src ./src

RUN npx prisma generate

RUN pnpm build

# ── Stage 3: producción ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist         ./dist
COPY --from=builder --chown=app:app /app/prisma       ./prisma
COPY --chown=app:app package.json ./

USER app

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
