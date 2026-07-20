#!/usr/bin/env bash
# =============================================================================
# fix-redis-dev-mode.sh
# Agrega soporte REDIS_ENABLED=false en los tres servicios:
#   - realsass-sass-back
#   - chatia-backend  (chat-ia-back)
#   - pagos-back
#
# Uso:
#   SERVICE=sass-back    bash fix-redis-dev-mode.sh
#   SERVICE=chat-ia-back bash fix-redis-dev-mode.sh
#   SERVICE=pagos-back   bash fix-redis-dev-mode.sh
#
# Variable de entorno a agregar en cada servicio: REDIS_ENABLED=false
# =============================================================================
set -euo pipefail

SERVICE="pagos-back"

if [ -z "$SERVICE" ]; then
  echo "❌  Especificá SERVICE. Ejemplo:"
  echo "    SERVICE=sass-back    bash fix-redis-dev-mode.sh"
  echo "    SERVICE=chat-ia-back bash fix-redis-dev-mode.sh"
  echo "    SERVICE=pagos-back   bash fix-redis-dev-mode.sh"
  exit 1
fi

# ══════════════════════════════════════════════════════════════════════════════
# SASS-BACK
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "sass-back" ]; then
  echo "🔧  [sass-back] Actualizando redis.service.ts..."

  FILE="src/redis/redis.service.ts"
  [ -f "$FILE" ] || { echo "❌  $FILE no encontrado"; exit 1; }
  cp "$FILE" "${FILE}.bak"

  cat > "$FILE" << 'TSEOF'
// src/redis/redis.service.ts
// REDIS_ENABLED=false → no-op (útil en dev sin Redis)
// REDIS_ENABLED=true  → conexión real via REDIS_URL
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

const REDIS_OPTIONS: RedisOptions = {
  retryStrategy:    (r) => (r > 10 ? null : Math.min(r * 200, 5_000)),
  reconnectOnError: (e) => e.message.includes('ECONNRESET') ? 2 : false,
  lazyConnect:         true,
  maxRetriesPerRequest: 3,
  connectTimeout:      10_000,
  enableOfflineQueue:  true,
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  private get enabled(): boolean {
    return process.env['REDIS_ENABLED'] === 'true';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Redis deshabilitado (REDIS_ENABLED != true) — modo no-op');
      return;
    }
    const url = process.env['REDIS_URL'];
    if (!url) {
      this.logger.warn('REDIS_URL no configurada — Redis en modo no-op');
      return;
    }
    this.client = new Redis(url, REDIS_OPTIONS);
    this.client.on('error',        (e: Error)  => this.logger.warn(`Redis error: ${e.message}`));
    this.client.on('reconnecting', (d: number) => this.logger.log(`Redis reconectando en ${d}ms...`));
    this.client.on('connect',      ()          => this.logger.log('Redis conectado ✓'));
    try { await this.client.connect(); }
    catch (e) { this.logger.error(`Redis no disponible: ${e} — modo no-op`); this.client = null; }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.client ? this.client.get(key) : null;
  }
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    ttlSeconds ? await this.client.set(key, value, 'EX', ttlSeconds)
               : await this.client.set(key, value);
  }
  async del(key: string): Promise<void> {
    if (this.client) await this.client.del(key);
  }
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }
  get isConnected(): boolean { return this.client?.status === 'ready'; }
}
TSEOF

  echo "🔧  [sass-back] Actualizando app.module.ts — BullModule condicional..."
  APP="src/app.module.ts"
  cp "$APP" "${APP}.bak"

  # Reemplazar BullModule.forRoot con versión condicional
  node -e "
const fs = require('fs');
let src = fs.readFileSync('$APP', 'utf8');
src = src.replace(
  /BullModule\.forRoot\(\{[\s\S]*?\}\),/,
  \`...(process.env['REDIS_ENABLED'] === 'true'
      ? [BullModule.forRoot({ connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' } })]
      : []),\`
);
fs.writeFileSync('$APP', src);
"
  echo "✅  [sass-back] Listo — agregá REDIS_ENABLED=false en las variables de entorno"
fi

# ══════════════════════════════════════════════════════════════════════════════
# CHAT-IA-BACK
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "chat-ia-back" ]; then
  echo "🔧  [chat-ia-back] Actualizando queue.module.ts..."

  FILE="src/queue/queue.module.ts"
  [ -f "$FILE" ] || { echo "❌  $FILE no encontrado"; exit 1; }
  cp "$FILE" "${FILE}.bak"

  cat > "$FILE" << 'TSEOF'
// src/queue/queue.module.ts
// REDIS_ENABLED=false → BullModule no se inicializa, workers no corren.
// Los processors fallan silenciosamente si se encola sin Redis — aceptable en dev.
import { Module }      from '@nestjs/common';
import { BullModule }  from '@nestjs/bullmq';
import { QUEUES }      from './queue.constants';
import { IncomingMessageProcessor } from './processors/incoming-message.processor';
import { OutgoingMessageProcessor } from './processors/outgoing-message.processor';
import { ChannelsModule }      from '../channels/channel.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { EventsModule }        from '../events/events.module';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';
const REDIS_URL     = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

@Module({
  imports: [
    ...(REDIS_ENABLED ? [
      BullModule.forRoot({ connection: { url: REDIS_URL } }),
      BullModule.registerQueue(
        { name: QUEUES.INCOMING_MESSAGE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 } },
        { name: QUEUES.OUTGOING_MESSAGE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 } },
      ),
    ] : []),
    ChannelsModule,
    ConversationsModule,
    EventsModule,
  ],
  providers: REDIS_ENABLED ? [IncomingMessageProcessor, OutgoingMessageProcessor] : [],
  exports: [BullModule],
})
export class QueueModule {}
TSEOF

  echo "🔧  [chat-ia-back] Actualizando common/services/cache.service.ts..."
  CACHE="src/common/services/cache.service.ts"
  if [ -f "$CACHE" ]; then
    cp "$CACHE" "${CACHE}.bak"
    # Agregar guard REDIS_ENABLED al principio del archivo
    node -e "
const fs = require('fs');
let src = fs.readFileSync('$CACHE', 'utf8');
if (!src.includes('REDIS_ENABLED')) {
  // Agregar chequeo en get() y set()
  src = src.replace(
    'async get<T>(',
    \`private get redisEnabled() { return process.env['REDIS_ENABLED'] === 'true'; }

  async get<T>(\`
  );
}
fs.writeFileSync('$CACHE', src);
"
  fi

  echo "✅  [chat-ia-back] Listo — agregá REDIS_ENABLED=false en las variables de entorno"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PAGOS-BACK
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "pagos-back" ]; then
  echo "🔧  [pagos-back] Actualizando redis.module.ts..."

  REDIS="src/modules/redis/redis.module.ts"
  [ -f "$REDIS" ] || { echo "❌  $REDIS no encontrado"; exit 1; }
  cp "$REDIS" "${REDIS}.bak"

  cat > "$REDIS" << 'TSEOF'
// src/modules/redis/redis.module.ts
// REDIS_ENABLED=false → REDIS_CLIENT es un objeto no-op (noop Redis mock)
import { Global, Module }       from '@nestjs/common';
import { ConfigService }        from '@nestjs/config';
import Redis                    from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

/** Proxy no-op que devuelve valores neutros para todas las operaciones */
const noopRedis = new Proxy({} as Redis, {
  get: (_t, prop) => {
    if (prop === 'status') return 'ready';
    return (..._args: unknown[]) => Promise.resolve(null);
  },
});

@Global()
@Module({
  providers: [
    {
      provide:  REDIS_CLIENT,
      inject:   [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        if (!REDIS_ENABLED) {
          console.warn('[RedisModule] Redis deshabilitado (REDIS_ENABLED != true) — modo no-op');
          return noopRedis;
        }
        const url = config.getOrThrow<string>('REDIS_URL');
        const redis = new Redis(url, {
          lazyConnect:          false,
          enableReadyCheck:     true,
          maxRetriesPerRequest: 3,
          retryStrategy:        (t) => Math.min(t * 100, 3000),
        });
        redis.on('error', (err) => console.error('[Redis] error:', err.message));
        return redis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
TSEOF

  echo "🔧  [pagos-back] Actualizando queue.module.ts..."
  QUEUE="src/modules/queue/queue.module.ts"
  cp "$QUEUE" "${QUEUE}.bak"

  cat > "$QUEUE" << 'TSEOF'
// src/modules/queue/queue.module.ts
// REDIS_ENABLED=false → BullModule no se registra, workers no corren en dev
import { BullModule }    from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService }  from '@nestjs/config';
import { QUEUE_WEBHOOKS, QUEUE_RECONCILE, QUEUE_DLQ } from '../../common/constants/queues';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

@Global()
@Module({
  imports: REDIS_ENABLED ? [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 5,
          backoff:  { type: 'exponential', delay: 1_000 },
          removeOnComplete: { count: 200 },
          removeOnFail:     { count: 500 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_WEBHOOKS },
      { name: QUEUE_RECONCILE },
      { name: QUEUE_DLQ },
    ),
  ] : [],
  exports: [BullModule],
})
export class QueueModule {}
TSEOF

  echo "✅  [pagos-back] Listo — agregá REDIS_ENABLED=false en las variables de entorno"
fi

echo ""
echo "📋  Variables de entorno a agregar en Railway / .env:"
echo "    REDIS_ENABLED=false   ← dev sin Redis"
echo "    REDIS_ENABLED=true    ← prod con Redis (requiere REDIS_URL)"