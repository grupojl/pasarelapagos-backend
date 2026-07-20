// src/common/shared-guards.module.ts
//
// @Global(): una sola instancia de cada guard en todo el contenedor.
// Importado una única vez en AppModule — todos los demás módulos pueden
// usar @UseGuards() sin necesidad de importar este módulo individualmente.
import { Global, Module }      from '@nestjs/common';
import { FirebaseModule }      from '../modules/firebase/firebase.module';
import { TenantsModule }       from '../modules/tenants/tenants.module';
import { FirebaseAuthService } from '../modules/firebase/firebase-auth.service';
import { AuthGuard }           from './guards/auth.guard';
import { TenantGuard }         from './guards/tenant.guard';
import { ApiKeyGuard }         from './guards/api-key.guard';
import { RolesGuard }          from './guards/roles.guard';
import { WriteGuard }          from './guards/write.guard';
import { PciGuard }            from './guards/pci.guard';

@Global()
@Module({
  imports:  [FirebaseModule, TenantsModule],
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
