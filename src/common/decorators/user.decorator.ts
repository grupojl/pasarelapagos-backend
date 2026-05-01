import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from './roles.decorator';

export interface UserContext {
  id:       string;       // User.id de la DB
  uid:      string;       // Firebase UID
  email?:   string;
  name?:    string;
  role:     UserRole;
  tenantId: string;
}

export const User = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext => {
    const req = ctx.switchToHttp().getRequest<Record<string, any>>();
    return req['user'] as UserContext;
  },
);
