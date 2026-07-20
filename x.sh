#!/usr/bin/env bash
# =============================================================================
# fix-pagos-diagnose-and-fix.sh
# Diagnóstico + fix definitivo del problema de AuthGuard en PaymentsModule
# =============================================================================
set -euo pipefail

echo "═══════════════════════════════════════════════════"
echo "DIAGNÓSTICO — estado actual de los archivos en disco"
echo "═══════════════════════════════════════════════════"

for f in \
  src/common/shared-guards.module.ts \
  src/modules/auth/auth.module.ts \
  src/modules/payments/payments.module.ts \
  src/modules/webhooks/webhooks.module.ts \
  src/app.module.ts; do
  echo ""
  echo "──── $f ────"
  if [ -f "$f" ]; then
    cat "$f"
  else
    echo "❌ NO EXISTE"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "FIX — reescritura forzada de todos los archivos"
echo "═══════════════════════════════════════════════════"

# ── shared-guards.module.ts — @Global, TenantsModule importado directamente ──
cat > src/common/shared-guards.module.ts << 'TSEOF'
import { Global, Module } from '@nestjs/common';
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
  imports:   [FirebaseModule, TenantsModule],
  providers: [FirebaseAuthService, AuthGuard, TenantGuard, ApiKeyGuard, RolesGuard, WriteGuard, PciGuard],
  exports:   [FirebaseAuthService, AuthGuard, TenantGuard, ApiKeyGuard, RolesGuard, WriteGuard, PciGuard],
})
export class SharedGuardsModule {}
TSEOF
echo "✅  shared-guards.module.ts"

# ── auth.module.ts — SIN AuthGuard (ya es global) ────────────────────────────
cat > src/modules/auth/auth.module.ts << 'TSEOF'
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
echo "✅  auth.module.ts"

# ── payments.module.ts — SIN AuthGuard, SIN SharedGuardsModule (ya es global) ─
cat > src/modules/payments/payments.module.ts << 'TSEOF'
import { BullModule }            from '@nestjs/bullmq';
import { Module }                from '@nestjs/common';
import { PaymentsController }    from './payments.controller';
import { PaymentsService }       from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileProcessor }    from './reconcile.processor';
import { FakeModule }            from '../providers/adapters/fake/fake.module';
import { QUEUE_RECONCILE }       from '../../common/constants/queues';

@Module({
  imports: [
    FakeModule,
    BullModule.registerQueue({ name: QUEUE_RECONCILE }),
  ],
  controllers: [PaymentsController],
  providers:   [PaymentsService, ReconciliationService, ReconcileProcessor],
  exports:     [PaymentsService],
})
export class PaymentsModule {}
TSEOF
echo "✅  payments.module.ts"

# ── webhooks.module.ts — SIN SharedGuardsModule (ya es global) ───────────────
cat > src/modules/webhooks/webhooks.module.ts << 'TSEOF'
import { BullModule }           from '@nestjs/bullmq';
import { Module }               from '@nestjs/common';
import { WebhooksController }   from './webhooks.controller';
import { WebhookProcessor }     from './webhook.processor';
import { WebhookSecretService } from './webhook-secret.service';
import { QUEUE_WEBHOOKS }       from '../../common/constants/queues';

@Module({
  imports:     [BullModule.registerQueue({ name: QUEUE_WEBHOOKS })],
  controllers: [WebhooksController],
  providers:   [WebhookProcessor, WebhookSecretService],
  exports:     [WebhookSecretService],
})
export class WebhooksModule {}
TSEOF
echo "✅  webhooks.module.ts"

# ── app.module.ts — agregar SharedGuardsModule si no está ────────────────────
APP="src/app.module.ts"
if grep -q "SharedGuardsModule" "$APP"; then
  echo "⚠️  app.module.ts ya tiene SharedGuardsModule"
else
  cp "$APP" "${APP}.bak"
  sed -i "s|import { FirebaseModule } from './modules/firebase/firebase.module';|import { FirebaseModule }     from './modules/firebase/firebase.module';\nimport { SharedGuardsModule } from './common/shared-guards.module';|" "$APP"
  sed -i "s|    FirebaseModule,|    FirebaseModule,\n    SharedGuardsModule,|" "$APP"
  echo "✅  app.module.ts — SharedGuardsModule agregado"
fi

echo ""
echo "══════════ RESULTADO FINAL ══════════"
echo ""
grep -n "SharedGuardsModule\|AuthGuard\|TenantsModule\|FirebaseModule" \
  src/common/shared-guards.module.ts \
  src/modules/auth/auth.module.ts \
  src/modules/payments/payments.module.ts \
  src/modules/webhooks/webhooks.module.ts \
  src/app.module.ts 2>/dev/null || true