// src/modules/firebase/firebase-auth.service.ts
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from './firebase.module';

export interface FirebaseDecodedToken {
  uid: string;
  email?: string;
  name?: string;
  // Claims custom inyectados por el owner-dashboard
  organizationId?: string;
  productPermissions?: Record<string, { canRead: boolean; canWrite: boolean }>;
  organizations?: string[];
}

@Injectable()
export class FirebaseAuthService {
  private readonly logger = new Logger(FirebaseAuthService.name);

  constructor(
    @Inject(FIREBASE_ADMIN)
    private readonly firebase: admin.app.App | null,
  ) {}

  get isEnabled(): boolean {
    return this.firebase !== null;
  }

  /**
   * Verifica un ID token de Firebase y retorna los claims decodificados.
   * Lanza UnauthorizedException si el token es inválido o Firebase no está configurado.
   */
  async verifyToken(token: string): Promise<FirebaseDecodedToken> {
    if (!this.firebase) {
      throw new UnauthorizedException(
        'Firebase Auth no está configurado en este servidor',
      );
    }

    try {
      const decoded = await this.firebase.auth().verifyIdToken(token, true);
      return {
        uid:                decoded.uid,
        email:              decoded.email,
        name:               decoded.name,
        organizationId:     decoded['organizationId'] as string | undefined,
        productPermissions: decoded['productPermissions'] as
          | Record<string, { canRead: boolean; canWrite: boolean }>
          | undefined,
        organizations:      decoded['organizations'] as string[] | undefined,
      };
    } catch (err) {
      this.logger.warn(`Token Firebase inválido: ${(err as Error).message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
