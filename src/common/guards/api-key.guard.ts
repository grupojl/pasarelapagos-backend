import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ApiKeyService } from '../../modules/tenants/api-key.service';

/**
 * Guard de autenticación por API key.
 *
 * Sprint 1: validaba contra Tenant.apiKeyHash (una key por tenant).
 * Sprint 6: valida contra TenantApiKey (múltiples keys, expiración, revocación).
 *
 * Mantiene retrocompatibilidad: si existe la key legacy en Tenant.apiKeyHash
 * también la acepta durante la ventana de migración.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys:   ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req    = context.switchToHttp().getRequest<Record<string, any>>();
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) throw new UnauthorizedException('Falta el header x-api-key');

    const tenant = await this.apiKeys.validate(rawKey);
    if (!tenant)  throw new UnauthorizedException('API key inválida o expirada');

    req['tenant'] = tenant;
    return true;
  }
}
