import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface TenantContext {
  id: string;
  name: string;
}

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<Record<string, any>>();
    return req['tenant'] as TenantContext;
  },
);
