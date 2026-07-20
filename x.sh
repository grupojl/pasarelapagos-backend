#!/usr/bin/env bash
# =============================================================================
# fix-redis-dev-mode-v2.sh
# Corrige los tres errores del intento anterior:
#
# 1. [chat-ia + pagos] QueueModule exporta BullModule cuando no está importado
#    → solución: no exportar BullModule cuando REDIS_ENABLED=false
#
# 2. [sass-back] RedisService.set() cambió firma, falta keys() y del(...keys)
#    → solución: restaurar API completa compatible con ConfigCacheService
#
# Uso:
#   SERVICE=sass-back    bash fix-redis-dev-mode-v2.sh
#   SERVICE=chat-ia-back bash fix-redis-dev-mode-v2.sh
#   SERVICE=pagos-back   bash fix-redis-dev-mode-v2.sh
# =============================================================================
set -euo pipefail

SERVICE="pagos-back"
[ -z "$SERVICE" ] && { echo "❌  Especificá SERVICE=sass-back|chat-ia-back|pagos-back"; exit 1; }

# ══════════════════════════════════════════════════════════════════════════════
# SASS-BACK — fix RedisService API completa
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "sass-back" ]; then
  FILE="src/redis/redis.service.ts"
  [ -f "$FILE" ] || { echo "❌  $FILE no encontrado"; exit 1; }
  cp "$FILE" "${FILE}.bak"

  cat > "$FILE" << 'TSEOF'
// src/redis/redis.service.ts
// REDIS_ENABLED=true  → conexión real via REDIS_URL
// REDIS_ENABLED=false → todos los métodos son no-op (dev sin Redis)
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

const REDIS_OPTIONS: RedisOptions = {
  retryStrategy:        (r) => (r > 10 ? null : Math.min(r * 200, 5_000)),
  reconnectOnError:     (e) => (e.message.includes('ECONNRESET') ? 2 : false),
  lazyConnect:          true,
  maxRetriesPerRequest: 3,
  connectTimeout:       10_000,
  enableOfflineQueue:   true,
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

  // ── API pública — compatible con ConfigCacheService ────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client?.get(key) ?? null;
  }

  /** set con TTL opcional. Acepta tanto (key, value, ttl) como (key, value, 'EX', ttl) */
  async set(key: string, value: string, exOrTtl?: 'EX' | number, ttl?: number): Promise<void> {
    if (!this.client) return;
    if (typeof exOrTtl === 'number') {
      await this.client.set(key, value, 'EX', exOrTtl);
    } else if (exOrTtl === 'EX' && ttl !== undefined) {
      await this.client.set(key, value, 'EX', ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    await this.client.del(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.client) return [];
    return this.client.keys(pattern);
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

  echo "✅  [sass-back] redis.service.ts con API completa (set/del/keys compatibles)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# CHAT-IA-BACK — QueueModule sin exports cuando REDIS_ENABLED=false
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "chat-ia-back" ]; then
  FILE="src/queue/queue.module.ts"
  [ -f "$FILE" ] || { echo "❌  $FILE no encontrado"; exit 1; }
  cp "$FILE" "${FILE}.bak"

  cat > "$FILE" << 'TSEOF'
// src/queue/queue.module.ts
// REDIS_ENABLED=true  → BullModule activo, workers corriendo
// REDIS_ENABLED=false → sin BullModule, sin workers (dev sin Redis)
import { Module }     from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES }     from './queue.constants';
import { IncomingMessageProcessor } from './processors/incoming-message.processor';
import { OutgoingMessageProcessor } from './processors/outgoing-message.processor';
import { ChannelsModule }      from '../channels/channel.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { EventsModule }        from '../events/events.module';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';
const REDIS_URL     = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const bullImports = REDIS_ENABLED ? [
  BullModule.forRoot({ connection: { url: REDIS_URL } }),
  BullModule.registerQueue(
    { name: QUEUES.INCOMING_MESSAGE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 } },
    { name: QUEUES.OUTGOING_MESSAGE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 } },
  ),
] : [];

@Module({
  imports:   [...bullImports, ChannelsModule, ConversationsModule, EventsModule],
  providers: REDIS_ENABLED ? [IncomingMessageProcessor, OutgoingMessageProcessor] : [],
  exports:   REDIS_ENABLED ? [BullModule] : [],   // ← solo exporta si está importado
})
export class QueueModule {}
TSEOF

  echo "✅  [chat-ia-back] queue.module.ts — exports condicional corregido"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PAGOS-BACK — QueueModule sin exports cuando REDIS_ENABLED=false
# ══════════════════════════════════════════════════════════════════════════════
if [ "$SERVICE" = "pagos-back" ]; then
  QUEUE="src/modules/queue/queue.module.ts"
  [ -f "$QUEUE" ] || { echo "❌  $QUEUE no encontrado"; exit 1; }
  cp "$QUEUE" "${QUEUE}.bak"

  cat > "$QUEUE" << 'TSEOF'
// src/modules/queue/queue.module.ts
// REDIS_ENABLED=true  → BullModule activo
// REDIS_ENABLED=false → sin BullModule (dev sin Redis)
import { BullModule }     from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService }  from '@nestjs/config';
import { QUEUE_WEBHOOKS, QUEUE_RECONCILE, QUEUE_DLQ } from '../../common/constants/queues';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

const bullImports = REDIS_ENABLED ? [
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
] : [];

@Global()
@Module({
  imports: bullImports,
  exports: REDIS_ENABLED ? [BullModule] : [],   // ← solo exporta si está importado
})
export class QueueModule {}
TSEOF

  echo "✅  [pagos-back] queue.module.ts — exports condicional corregido"
fi

echo ""
echo "📋  Recordá agregar en Railway / .env de cada servicio:"
echo "    REDIS_ENABLED=false   ← dev"
echo "    REDIS_ENABLED=true    ← prod (requiere REDIS_URL)"