// src/common/guards/tenant.guard.ts
//
// Valida:
//   1. Header x-organization-id presente
//   2. El usuario pertenece a esa org (via claim 'organizations' en el token)
//   3. productPermissions["payments"] existe con al menos canRead=true
//
// Para path B2B (x-api-key): la org ya está resuelta en AuthGuard,
// se asumen permisos totales (canRead + canWrite).
//
// NOTA SOBRE PRODUCTPERMISSIONS:
//   Los claims custom del token Firebase son inyectados por el owner-dashboard
//   cuando hace login. Si el token es viejo (antes de agregar permisos),
//   se consulta opcionalmente al dashboard via DASHBOARD_API_URL.
//   Por ahora: validamos desde claims + fallback a canRead=true si no hay claims
//   (para no romper en desarrollo sin dashboard configurado).
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrgContext } from '../interfaces/org-context.interface';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';

const PRODUCT_KEY = 'payments';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const orgIdHeader = (req['headers'] as Record<string, string>)[
      'x-organization-id'
    ];

    // --- Path B2B (API Key): tenant ya resuelto en AuthGuard ---
    const isApiKey = req['organizationId'] !== undefined && !req['user'];
    if (isApiKey) {
      const ctx: OrgContext = {
        organizationId: req['organizationId'] as string,
        userId:         'api-key',
        canRead:        true,
        canWrite:       true,
        isApiKey:       true,
      };
      req['orgContext'] = ctx;
      // Mantener compatibilidad con @Tenant() decorator existente
      req['tenant'] = { id: ctx.organizationId, name: 'api-key-tenant' };
      return true;
    }

    // --- Path SSO (Firebase Bearer) ---
    if (!orgIdHeader) {
      throw new BadRequestException('Header x-organization-id requerido');
    }

    const user = req['user'] as {
      uid: string;
      email?: string;
      organizations?: string[];
      productPermissions?: Record<string, { canRead: boolean; canWrite: boolean }>;
    } | undefined;

    if (!user?.uid) {
      throw new BadRequestException(
        'Usuario no autenticado — FirebaseAuthGuard debe correr antes de TenantGuard',
      );
    }

    // Validar que el usuario pertenece a la org solicitada
    const userOrgs = user.organizations ?? [];
    const isDev    = this.config.get<string>('NODE_ENV') !== 'production';

    if (userOrgs.length > 0 && !userOrgs.includes(orgIdHeader)) {
      this.logger.warn(
        `Usuario ${user.uid} no pertenece a la org ${orgIdHeader}`,
      );
      throw new ForbiddenException(
        'No pertenecés a la organización indicada',
      );
    }

    // Validar productPermissions["payments"]
    const perms     = user.productPermissions?.[PRODUCT_KEY];
    const canRead   = perms?.canRead  ?? isDev; // dev fallback
    const canWrite  = perms?.canWrite ?? isDev;

    if (!canRead) {
      this.logger.warn(
        `Usuario ${user.uid} sin acceso a ${PRODUCT_KEY} en org ${orgIdHeader}`,
      );
      throw new ForbiddenException(
        `Sin acceso al módulo "${PRODUCT_KEY}" en esta organización`,
      );
    }

    const ctx: OrgContext = {
      organizationId: orgIdHeader,
      userId:         user.uid,
      canRead,
      canWrite,
      isApiKey:       false,
    };

    req['orgContext']      = ctx;
    req['organizationId']  = orgIdHeader;
    // Mantener compatibilidad con @Tenant() decorator existente
    req['tenant'] = { id: orgIdHeader, name: orgIdHeader };

    return true;
  }
}
