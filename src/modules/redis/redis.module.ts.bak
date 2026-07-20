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
