import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';

/**
 * Guard de RBAC.
 * Se aplica DESPUÉS de AuthGuard — req['user'] ya está seteado.
 * Si no hay @Roles() en el endpoint → permite el acceso (solo auth requerida).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin @Roles() → solo requiere estar autenticado
    if (!required || required.length === 0) return true;

    const req  = context.switchToHttp().getRequest<Record<string, any>>();
    const user = req['user'] as { role?: UserRole } | undefined;

    if (!user?.role) {
      throw new ForbiddenException('Sin rol asignado para este tenant');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Rol '${user.role}' no tiene acceso. Requerido: ${required.join(' | ')}`,
      );
    }

    return true;
  }
}
