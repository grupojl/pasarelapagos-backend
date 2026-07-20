#!/usr/bin/env bash
# =============================================================================
# fix-pagos-shared-guards.sh
# Fix: AuthGuard / TenantGuard no resuelven sus dependencias en PaymentsModule
#      ni en WebhooksModule porque esos módulos no importan los proveedores
#      necesarios (FirebaseAuthService, ApiKeyService, PrismaService).
#
# Solución: crear SharedGuardsModule que centraliza todos los guards comunes
#           y que PaymentsModule + WebhooksModule importan.
#           AuthModule ya exporta AuthGuard (fix anterior), pero los otros
#           módulos tampoco lo importaban.
#
# Repo: pagos-back (src en raíz)
# =============================================================================
set -euo pipefail

echo "🔍  Verificando estructura..."

if [ ! -f "src/modules/auth/auth.module.ts" ]; then
  echo "❌  No se encontró src/modules/auth/auth.module.ts"
  echo "    Corré el script desde la raíz del repo pagos-back"
  exit 1
fi

# ── 1. SharedGuardsModule ────────────────────────────────────────────────────
echo "🔧  Creando SharedGuardsModule..."

cat > src/common/shared-guards.module.ts << 'TSEOF'
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
TSEOF

echo "✅  SharedGuardsModule creado"

# ── 2. PaymentsModule — importar SharedGuardsModule ──────────────────────────
echo "🔧  Actualizando PaymentsModule..."
PAYMENTS="src/modules/payments/payments.module.ts"
cp "$PAYMENTS" "${PAYMENTS}.bak"

cat > "$PAYMENTS" << 'TSEOF'
// src/modules/payments/payments.module.ts
import { BullModule }          from '@nestjs/bullmq';
import { Module }              from '@nestjs/common';
import { PaymentsController }  from './payments.controller';
import { PaymentsService }     from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileProcessor }  from './reconcile.processor';
import { FakeModule }          from '../providers/adapters/fake/fake.module';
import { SharedGuardsModule }  from '../../common/shared-guards.module';
import { QUEUE_RECONCILE }     from '../../common/constants/queues';

@Module({
  imports: [
    FakeModule,
    SharedGuardsModule,
    BullModule.registerQueue({ name: QUEUE_RECONCILE }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ReconciliationService,
    ReconcileProcessor,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
TSEOF

echo "✅  PaymentsModule actualizado"

# ── 3. WebhooksModule — importar SharedGuardsModule ──────────────────────────
echo "🔧  Actualizando WebhooksModule..."
WEBHOOKS="src/modules/webhooks/webhooks.module.ts"
cp "$WEBHOOKS" "${WEBHOOKS}.bak"

cat > "$WEBHOOKS" << 'TSEOF'
// src/modules/webhooks/webhooks.module.ts
import { BullModule }         from '@nestjs/bullmq';
import { Module }             from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookProcessor }   from './webhook.processor';
import { WebhookSecretService } from './webhook-secret.service';
import { SharedGuardsModule } from '../../common/shared-guards.module';
import { QUEUE_WEBHOOKS }     from '../../common/constants/queues';

@Module({
  imports: [
    SharedGuardsModule,
    BullModule.registerQueue({ name: QUEUE_WEBHOOKS }),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhookProcessor,
    WebhookSecretService,
  ],
  exports: [WebhookSecretService],
})
export class WebhooksModule {}
TSEOF

echo "✅  WebhooksModule actualizado"

# ── 4. AuthModule — ya tiene TenantsModule y AuthGuard del fix anterior ───────
#       Verificamos que esté correcto y lo completamos con SharedGuardsModule
echo "🔧  Verificando AuthModule..."
AUTH="src/modules/auth/auth.module.ts"

if ! grep -q "SharedGuardsModule" "$AUTH"; then
  cp "$AUTH" "${AUTH}.bak2"
  cat > "$AUTH" << 'TSEOF'
// src/modules/auth/auth.module.ts
import { Module }              from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { SharedGuardsModule }  from '../../common/shared-guards.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';

@Module({
  imports:     [SharedGuardsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService],
  exports:     [FirebaseAuthService, SharedGuardsModule],
})
export class AuthModule {}
TSEOF
  echo "✅  AuthModule actualizado con SharedGuardsModule"
else
  echo "⚠️  AuthModule ya tiene SharedGuardsModule — sin cambios"
fi

echo ""
echo "📄  Resumen de cambios:"
echo "   + src/common/shared-guards.module.ts  (NUEVO)"
echo "   ~ src/modules/payments/payments.module.ts"
echo "   ~ src/modules/webhooks/webhooks.module.ts"
echo "   ~ src/modules/auth/auth.module.ts"
echo ""
echo "🔄  Reinicia el contenedor de pagos-back para aplicar los cambios"