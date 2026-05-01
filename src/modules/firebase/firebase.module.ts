// src/modules/firebase/firebase.module.ts
// Patrón idéntico al owner-dashboard — mismo FIREBASE_PROJECT_ID compartido.
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export const FIREBASE_ADMIN = 'FIREBASE_ADMIN';

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): admin.app.App | null => {
        const logger    = new Logger('FirebaseModule');
        const projectId = config.get<string>('FIREBASE_PROJECT_ID');

        if (!projectId) {
          logger.warn('FIREBASE_PROJECT_ID no configurado — Firebase desactivado');
          return null;
        }

        // Evitar inicialización duplicada (hot reload)
        const existing = admin.apps.find((a) => a?.name === '[DEFAULT]');
        if (existing) return existing;

        const clientEmail = config.get<string>('FIREBASE_CLIENT_EMAIL');
        const privateKey  = config
          .get<string>('FIREBASE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n');

        try {
          const app = admin.initializeApp({
            credential:
              clientEmail && privateKey
                ? admin.credential.cert({ projectId, clientEmail, privateKey })
                : admin.credential.applicationDefault(),
            projectId,
          });
          logger.log(`Firebase inicializado — proyecto: ${projectId}`);
          return app;
        } catch (err) {
          logger.error('Error inicializando Firebase', err);
          return null;
        }
      },
    },
  ],
  exports: [FIREBASE_ADMIN],
})
export class FirebaseModule {}
