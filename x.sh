#!/usr/bin/env bash
# =============================================================================
# fix-pagos-global-guards.sh
# Fix definitivo: el DI container crea instancias separadas de AuthGuard
# por módulo, y en PaymentsModule no encuentra ApiKeyService porque está
# resolviendo desde el scope de AuthModule (que también lo declara).
#
# Solución: hacer SharedGuardsModule @Global() — una sola instancia de cada
# guard en todo el contenedor. Además limpiar AuthModule para que NO declare
# AuthGuard (evitar registros duplicados que confunden al container).
# =============================================================================
set -euo pipefail

echo "🔍  Verificando estructura..."
if [ ! -f "src/common/shared-guards.module.ts" ]; then
  echo "❌  No se encontró src/common/shared-guards.module.ts"
  echo "    Corré desde la raíz del repo pagos-back"
  exit 1
fi

# ── 1. SharedGuardsModule → @Global() ────────────────────────────────────────
echo "🔧  Haciendo SharedGuardsModule global..."
cp src/common/shared-guards.module.ts src/common/shared-guards.module.ts.bak

cat > src/common/shared-guards.module.ts << 'TSEOF'
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
TSEOF
echo "✅  SharedGuardsModule ahora es @Global()"

# ── 2. AuthModule — sacar AuthGuard de providers/exports (ya es global) ───────
echo "🔧  Limpiando AuthModule..."
cp src/modules/auth/auth.module.ts src/modules/auth/auth.module.ts.bak

cat > src/modules/auth/auth.module.ts << 'TSEOF'
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
TSEOF
echo "✅  AuthModule limpio (sin AuthGuard duplicado)"

# ── 3. AppModule — importar SharedGuardsModule una sola vez ──────────────────
echo "🔧  Verificando AppModule..."
APP="src/app.module.ts"

if grep -q "SharedGuardsModule" "$APP"; then
  echo "⚠️  SharedGuardsModule ya está en AppModule — sin cambios"
else
  cp "$APP" "${APP}.bak"
  # Insertar import del módulo después de la línea de FirebaseModule
  sed -i "s|import { FirebaseModule } from './modules/firebase/firebase.module';|import { FirebaseModule }    from './modules/firebase/firebase.module';\nimport { SharedGuardsModule } from './common/shared-guards.module';|" "$APP"
  # Agregar SharedGuardsModule en el array de imports del @Module (después de FirebaseModule)
  sed -i "s|FirebaseModule,|FirebaseModule,\n    SharedGuardsModule,|" "$APP"
  echo "✅  SharedGuardsModule agregado a AppModule"
fi

# ── 4. PaymentsModule y WebhooksModule — pueden quitar SharedGuardsModule ────
#       ya que es @Global(), pero dejarlo no hace daño — NestJS deduplica.
echo ""
echo "📄  Resumen:"
echo "   SharedGuardsModule es @Global() → una instancia, accesible en todo el app"
echo "   AuthModule         → sin AuthGuard duplicado"  
echo "   AppModule          → importa SharedGuardsModule"
echo "   PaymentsModule     → puede mantener el import (idempotente con @Global)"
echo "   WebhooksModule     → ídem"