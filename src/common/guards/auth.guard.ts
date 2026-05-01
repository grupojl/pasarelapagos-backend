// src/common/guards/auth.guard.ts
// Guard dual que acepta:
//   1. Authorization: Bearer {firebaseToken}  → SSO del ecosistema
//   2. x-api-key: pk_{prefix}_{random}        → B2B / server-to-server
//
// Resultado en req:
//   req['organizationId']  — siempre (ambos paths)
//   req['user']            — solo Firebase (uid, email, productPermissions)
//   req['tenant']          — siempre { id, name } para compatibilidad backward
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { FirebaseAuthService } from '../../modules/firebase/firebase-auth.service';
import { ApiKeyService } from '../../modules/tenants/api-key.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly firebase:  FirebaseAuthService,
    private readonly apiKeys:   ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Record<string, unknown>>();

    // ---- Path 1: API Key B2B ------------------------------------------------
    const apiKey = (req['headers'] as Record<string, string>)['x-api-key'];
    if (apiKey) {
      const tenant = await this.apiKeys.validate(apiKey);
      if (!tenant) throw new UnauthorizedException('API key inválida o expirada');

      req['tenant']         = { id: tenant.id, name: tenant.name };
      req['organizationId'] = tenant.id; // tenantId === organizationId en B2B
      return true;
    }

    // ---- Path 2: Firebase Bearer --------------------------------------------
    const authHeader = (req['headers'] as Record<string, string>)['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token   = authHeader.slice(7);
      const decoded = await this.firebase.verifyToken(token);

      req['firebaseUser'] = decoded;
      req['user'] = {
        uid:                decoded.uid,
        email:              decoded.email,
        name:               decoded.name,
        productPermissions: decoded.productPermissions ?? {},
        organizations:      decoded.organizations ?? [],
      };

      // organizationId se fija en TenantGuard tras validar x-organization-id
      return true;
    }

    throw new UnauthorizedException(
      'Autenticación requerida: x-api-key o Authorization: Bearer <token>',
    );
  }
}
