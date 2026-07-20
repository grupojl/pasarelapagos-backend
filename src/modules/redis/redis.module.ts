// src/modules/redis/redis.module.ts
// REDIS_ENABLED=true  → cliente Redis real via REDIS_URL
// REDIS_ENABLED=false → objeto mock sin ninguna conexión (dev sin Redis)
import { Global, Module }   from '@nestjs/common';
import { ConfigService }    from '@nestjs/config';
import Redis                from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

/**
 * Mock de Redis para desarrollo sin Redis.
 * No instancia ioredis — cero conexiones de red.
 */
class RedisNoopClient {
  readonly status = 'ready';
  async get(_key: string)                              { return null; }
  async set(_key: string, _val: string, ..._a: unknown[]) { return null; }
  async del(..._keys: string[])                        { return 0; }
  async incr(_key: string)                             { return 0; }
  async expire(_key: string, _ttl: number)             { return 0; }
  async keys(_pattern: string)                         { return []; }
  async hget(_key: string, _field: string)             { return null; }
  async hset(_key: string, ..._args: unknown[])        { return 0; }
  on(_event: string, _cb: unknown)                     { return this; }
  quit()                                               { return Promise.resolve(); }
}

@Global()
@Module({
  providers: [
    {
      provide:    REDIS_CLIENT,
      inject:     [ConfigService],
      useFactory: (config: ConfigService): Redis | RedisNoopClient => {
        if (!REDIS_ENABLED) {
          console.warn('[RedisModule] Redis deshabilitado (REDIS_ENABLED != true) — modo no-op');
          return new RedisNoopClient() as unknown as Redis;
        }
        const url   = config.getOrThrow<string>('REDIS_URL');
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
