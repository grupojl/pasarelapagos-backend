#!/usr/bin/env bash
# =============================================================================
# fix-pagos-throttler-guard-v2.sh
# Fix: TenantThrottlerGuard.onModuleInit falla porque super({} as any, ...)
# deja this.options undefined → el onModuleInit de ThrottlerGuard base
# llama .sort() sobre undefined.
#
# Solución: en lugar de extender ThrottlerGuard (que requiere options en super),
# implementar CanActivate directamente. La lógica de rate limit por tenant
# ya estaba 100% en Redis — no usamos nada de ThrottlerGuard base.
# =============================================================================
set -euo pipefail

FILE="src/common/guards/tenant-throttler.guard.ts"

if [ ! -f "$FILE" ]; then
  echo "❌  No se encontró $FILE — corré desde la raíz del repo pagos-back"
  exit 1
fi

cp "$FILE" "${FILE}.bak"
echo "💾  Backup en ${FILE}.bak"

cat > "$FILE" << 'TSEOF'
// src/common/guards/tenant-throttler.guard.ts
//
// Rate limiter por tenant usando Redis directamente.
// Ya NO extiende ThrottlerGuard — esa clase requiere inyectar ThrottlerModuleOptions
// en el constructor y ejecuta onModuleInit() que falla con opciones vacías.
// La lógica de rate limit es 100% propia via Redis, sin dependencia de ThrottlerGuard.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class TenantThrottlerGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Rutas públicas exentas
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req    = context.switchToHttp().getRequest<Record<string, any>>();
    const tenant = req['tenant'] as { id: string } | undefined;

    // Sin tenant resuelto aún (AuthGuard corre antes) → dejar pasar
    if (!tenant?.id) return true;

    const ttl    = Number(process.env['THROTTLE_TTL']              ?? 60);
    const limit  = Number(process.env['THROTTLE_LIMIT_PER_TENANT'] ?? process.env['THROTTLE_LIMIT'] ?? 200);
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
TSEOF

echo "✅  tenant-throttler.guard.ts reescrito (CanActivate directo, sin ThrottlerGuard base)"
echo ""
echo "📄  Resultado:"
cat "$FILE"