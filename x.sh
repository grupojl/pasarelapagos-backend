#!/usr/bin/env bash
# =============================================================================
# fix-pagos-auth-module-v2.sh
# Fix definitivo: AuthModule no debe importar SharedGuardsModule —
# es quien provee las piezas base (FirebaseAuthService).
# AuthModule solo necesita FirebaseModule + TenantsModule directamente.
# SharedGuardsModule los importa a él, no al revés.
# =============================================================================
set -euo pipefail

AUTH="src/modules/auth/auth.module.ts"

echo "🔍  Verificando $AUTH ..."
if [ ! -f "$AUTH" ]; then
  echo "❌  No se encontró $AUTH — corré desde la raíz del repo pagos-back"
  exit 1
fi

cp "$AUTH" "${AUTH}.bak"
echo "💾  Backup en ${AUTH}.bak"

cat > "$AUTH" << 'TSEOF'
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
TSEOF

echo "✅  auth.module.ts corregido"

# SharedGuardsModule también debe importar FirebaseModule + TenantsModule
# directamente (no depender de AuthModule para evitar dependencia circular)
SHARED="src/common/shared-guards.module.ts"
echo "🔧  Verificando SharedGuardsModule..."

cp "$SHARED" "${SHARED}.bak"

cat > "$SHARED" << 'TSEOF'
// src/common/shared-guards.module.ts
//
// Importado por módulos de feature que usan guards con @UseGuards().
// Centraliza todas las dependencias que los guards necesitan.
import { Module }              from '@nestjs/common';
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
TSEOF

echo "✅  SharedGuardsModule corregido"
echo ""
echo "📄  Estado final:"
echo "   AuthModule       → imports: [FirebaseModule, TenantsModule]"
echo "   SharedGuardsModule → imports: [FirebaseModule, TenantsModule]"
echo "   PaymentsModule   → imports: [SharedGuardsModule, ...]"
echo "   WebhooksModule   → imports: [SharedGuardsModule, ...]"