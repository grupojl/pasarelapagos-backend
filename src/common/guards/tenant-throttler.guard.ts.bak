import {
  ExecutionContext,
  Injectable,
  Inject,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Rate limiter por tenant usando Redis como storage.
 *
 * Clave:  rl:{tenantId}:{windowStart}
 * Límite: configurable por env (THROTTLE_LIMIT_PER_TENANT, default 200 req/min)
 *
 * Las rutas públicas (webhooks, health) están exentas.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflectorInstance: Reflector,
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflectorInstance.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req    = context.switchToHttp().getRequest<Record<string, any>>();
    const tenant = req['tenant'] as { id: string } | undefined;
    if (!tenant) return true;

    const ttl    = Number(process.env.THROTTLE_TTL    ?? 60);
    const limit  = Number(process.env.THROTTLE_LIMIT_PER_TENANT ?? process.env.THROTTLE_LIMIT ?? 200);
    const window = Math.floor(Date.now() / 1000 / ttl);
    const key    = `rl:${tenant.id}:${window}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, ttl + 5);
    }

    if (current > limit) {
      throw new ThrottlerException();
    }

    return true;
  }
}
