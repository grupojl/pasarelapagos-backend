// src/common/guards/firebase-auth.guard.ts
// Guard idéntico al del owner-dashboard — mismo contrato, mismo FIREBASE_PROJECT_ID.
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from '../../modules/firebase/firebase.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);

  constructor(
    @Inject(FIREBASE_ADMIN)
    private readonly firebase: admin.app.App | null,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token   = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Autenticación requerida: Authorization: Bearer <firebaseToken>',
      );
    }

    if (!this.firebase) {
      throw new UnauthorizedException(
        'Firebase no configurado en este entorno',
      );
    }

    try {
      const decoded = await this.firebase.auth().verifyIdToken(token, true);

      // Tipado seguro gracias a src/common/types/express.d.ts
      request.firebaseUser = decoded;
      request.user = {
        uid:                decoded.uid,
        email:              decoded.email ?? '',
        // Claims custom del owner-dashboard
        productPermissions: (decoded['productPermissions'] as Record<string, { canRead: boolean; canWrite: boolean }>) ?? {},
        organizations:      (decoded['organizations'] as string[]) ?? [],
      };

      return true;
    } catch (err) {
      this.logger.warn(`Token inválido: ${(err as Error).message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractBearerToken(request: Request): string | null {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : null;
  }
}
