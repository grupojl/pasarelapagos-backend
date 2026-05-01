// src/common/guards/write.guard.ts
// Usar en endpoints que crean/modifican datos.
// Requiere que TenantGuard ya haya corrido (para tener orgContext).
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { OrgContext } from '../interfaces/org-context.interface';

@Injectable()
export class WriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const ctx = req['orgContext'] as OrgContext | undefined;

    if (!ctx?.canWrite) {
      throw new ForbiddenException(
        'No tenés permisos de escritura en este módulo',
      );
    }
    return true;
  }
}
