#!/usr/bin/env bash
# =============================================================================
# fix-pagos-tenant-throttler.sh
# Fix: TenantThrottlerGuard no puede resolver el argumento en índice [2]
# Root cause: ThrottlerModuleOptions en el constructor no es inyectable por DI
# Solución: reescribir el guard sin ese parámetro — ThrottlerGuard base
#           lo resuelve internamente via ThrottlerModule.forRootAsync()
# Repo: pagos-back (src en raíz)
# =============================================================================
set -euo pipefail

FILE="src/common/guards/tenant-throttler.guard.ts"

echo "🔍  Verificando $FILE ..."

if [ ! -f "$FILE" ]; then
  echo "❌  No se encontró $FILE"
  echo "    Corré el script desde la raíz del repo pagos-back"
  exit 1
fi

# Idempotencia: si ya fue corregido no tiene ThrottlerModuleOptions
if ! grep -q "ThrottlerModuleOptions" "$FILE"; then
  echo "⚠️  ThrottlerModuleOptions ya no está en el guard — nada que hacer"
  exit 0
fi

# Backup
cp "$FILE" "${FILE}.bak"
echo "💾  Backup guardado en ${FILE}.bak"

cat > "$FILE" << 'TSEOF'
// src/common/guards/tenant-throttler.guard.ts
import {
  ExecutionContext,
  Injectable,
  Inject,
} from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerStorage,
} from '@nestjs/throttler';
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
 *
 * NOTA: ThrottlerModuleOptions NO se inyecta en el constructor —
 * ThrottlerGuard base lo resuelve internamente a través del módulo.
 * Inyectarlo explícitamente rompe el DI container en NestJS 11.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super({} as any, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req    = context.switchToHttp().getRequest<Record<string, any>>();
    const tenant = req['tenant'] as { id: string } | undefined;

    // Sin tenant resuelto: dejar pasar (AuthGuard ya lo validó)
    if (!tenant) return super.canActivate(context);

    const ttl    = Number(process.env['THROTTLE_TTL']               ?? 60);
    const limit  = Number(process.env['THROTTLE_LIMIT_PER_TENANT']  ?? process.env['THROTTLE_LIMIT'] ?? 200);
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

  // Tracker fallback para rutas sin tenant (usa IP o proyecto)
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const projectId      = req.headers?.['x-project-id']      as string | undefined;
    const organizationId = req.headers?.['x-organization-id'] as string | undefined;

    if (projectId)      return `proj:${projectId}`;
    if (organizationId) return `org:${organizationId}`;

    return (req.ip as string | undefined) ?? req.connection?.remoteAddress ?? 'unknown';
  }
}
TSEOF

echo "✅  tenant-throttler.guard.ts actualizado"
echo ""
echo "📄  Contenido final:"
cat "$FILE"