// src/modules/auth/auth.module.ts
//
// Módulo base de autenticación. Provee FirebaseAuthService.
// NO importa SharedGuardsModule — es quien alimenta a SharedGuardsModule.
// Dependencias directas: FirebaseModule (Firebase Admin) + TenantsModule (ApiKeyService).
import { Module }              from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { FirebaseModule }      from '../firebase/firebase.module';
import { TenantsModule }       from '../tenants/tenants.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';
import { AuthGuard }           from '../../common/guards/auth.guard';

@Module({
  imports:     [FirebaseModule, TenantsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService, AuthGuard],
  exports:     [FirebaseAuthService, AuthGuard],
})
export class AuthModule {}
