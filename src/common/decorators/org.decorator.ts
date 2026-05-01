// src/common/decorators/org.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrgContext } from '../interfaces/org-context.interface';

/**
 * @OrgCtx() — inyecta el OrgContext en el parámetro del controller.
 * Requiere que TenantGuard haya corrido antes.
 *
 * Uso:
 *   @Get()
 *   findAll(@OrgCtx() ctx: OrgContext) { ... }
 */
export const OrgCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return request['orgContext'] as OrgContext;
  },
);
