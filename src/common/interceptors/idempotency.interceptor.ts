import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../../modules/redis/redis.module';

const TTL_SECONDS = 86_400; // 24h

/**
 * Interceptor de idempotencia basado en Redis.
 *
 * Clave:  idemp:{tenantId}:{idempotency-key}
 * Valor:  { bodyHash, statusCode, response }
 *
 * Flujo:
 *  1. Si no hay header Idempotency-Key  → pasa sin guardar.
 *  2. Si no existe en Redis             → ejecuta y guarda resultado.
 *  3. Si existe y bodyHash coincide     → retorna respuesta cacheada (replay).
 *  4. Si existe y bodyHash difiere      → 409 Conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest<Record<string, any>>();
    const res = ctx.switchToHttp().getResponse<Record<string, any>>();

    const idempKey: string | undefined = req.headers['idempotency-key'];
    if (!idempKey) return next.handle();

    const tenant: { id: string } | undefined = req['tenant'];
    const tenantId = tenant?.id ?? 'anonymous';

    const redisKey = `idemp:${tenantId}:${idempKey}`;
    const bodyHash = this.hash(JSON.stringify(req.body ?? {}));

    return new Observable((subscriber) => {
      this.redis
        .get(redisKey)
        .then(async (cached) => {
          if (cached) {
            const entry = JSON.parse(cached) as {
              bodyHash: string;
              statusCode: number;
              response: unknown;
            };

            if (entry.bodyHash !== bodyHash) {
              subscriber.error(
                new ConflictException(
                  'Idempotency-Key reutilizada con un body diferente',
                ),
              );
              return;
            }

            // Replay: mismo statusCode + body cacheado
            res.status(entry.statusCode);
            subscriber.next(entry.response);
            subscriber.complete();
            return;
          }

          // Ejecutar el handler y guardar resultado
          next
            .handle()
            .pipe(
              tap(async (response) => {
                const statusCode: number = res.statusCode ?? 201;
                await this.redis.setex(
                  redisKey,
                  TTL_SECONDS,
                  JSON.stringify({ bodyHash, statusCode, response }),
                );
              }),
            )
            .subscribe({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            });
        })
        .catch((err) => subscriber.error(err));
    });
  }

  private hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
