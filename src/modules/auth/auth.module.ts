// src/modules/auth/auth.module.ts
//
// Módulo de autenticación. Solo provee FirebaseAuthService y el controller.
// AuthGuard, TenantGuard, etc. viven en SharedGuardsModule (@Global) —
// no se re-declaran aquí para evitar instancias duplicadas en el container.
import { Module }              from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { FirebaseModule }      from '../firebase/firebase.module';
import { TenantsModule }       from '../tenants/tenants.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';

@Module({
  imports:     [FirebaseModule, TenantsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService],
  exports:     [FirebaseAuthService],
})
export class AuthModule {}
