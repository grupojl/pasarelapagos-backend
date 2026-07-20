// src/common/shared-guards.module.ts
//
// Módulo que agrupa y exporta todos los guards de aplicación para que
// cualquier módulo de negocio (PaymentsModule, WebhooksModule, etc.)
// pueda usarlos con @UseGuards() sin repetir imports de dependencias.
//
// Patrón: Feature modules importan SharedGuardsModule en lugar de
//         importar FirebaseModule + TenantsModule individualmente.
import { Module } from '@nestjs/common';
import { FirebaseModule }      from '../modules/firebase/firebase.module';
import { TenantsModule }       from '../modules/tenants/tenants.module';
import { FirebaseAuthService } from '../modules/firebase/firebase-auth.service';
import { AuthGuard }           from './guards/auth.guard';
import { TenantGuard }         from './guards/tenant.guard';
import { ApiKeyGuard }         from './guards/api-key.guard';
import { RolesGuard }          from './guards/roles.guard';
import { WriteGuard }          from './guards/write.guard';
import { PciGuard }            from './guards/pci.guard';

@Module({
  imports: [FirebaseModule, TenantsModule],
  providers: [
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    WriteGuard,
    PciGuard,
  ],
  exports: [
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    WriteGuard,
    PciGuard,
  ],
})
export class SharedGuardsModule {}
