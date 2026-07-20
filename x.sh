#!/usr/bin/env bash
# =============================================================================
# fix-pagos-final.sh
# Fix definitivo: NestJS resuelve guards de @UseGuards() como injectables
# del módulo que contiene el controller — no del módulo global.
# PaymentsModule necesita tener acceso a ApiKeyService via TenantsModule.
# Solución: PaymentsModule importa TenantsModule + FirebaseModule directamente.
# No depende de @Global() para la resolución de injectables de guards.
# =============================================================================
set -euo pipefail

if [ ! -f "src/modules/payments/payments.module.ts" ]; then
  echo "❌  Corré desde la raíz del repo pagos-back"
  exit 1
fi

echo "🔧  Actualizando payments.module.ts..."
cat > src/modules/payments/payments.module.ts << 'TSEOF'
import { BullModule }            from '@nestjs/bullmq';
import { Module }                from '@nestjs/common';
import { PaymentsController }    from './payments.controller';
import { PaymentsService }       from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileProcessor }    from './reconcile.processor';
import { FakeModule }            from '../providers/adapters/fake/fake.module';
import { FirebaseModule }        from '../firebase/firebase.module';
import { TenantsModule }         from '../tenants/tenants.module';
import { FirebaseAuthService }   from '../firebase/firebase-auth.service';
import { AuthGuard }             from '../../common/guards/auth.guard';
import { TenantGuard }           from '../../common/guards/tenant.guard';
import { ApiKeyGuard }           from '../../common/guards/api-key.guard';
import { RolesGuard }            from '../../common/guards/roles.guard';
import { WriteGuard }            from '../../common/guards/write.guard';
import { PciGuard }              from '../../common/guards/pci.guard';
import { QUEUE_RECONCILE }       from '../../common/constants/queues';

@Module({
  imports: [
    FakeModule,
    FirebaseModule,
    TenantsModule,
    BullModule.registerQueue({ name: QUEUE_RECONCILE }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ReconciliationService,
    ReconcileProcessor,
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    WriteGuard,
    PciGuard,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
TSEOF
echo "✅  payments.module.ts"

echo "🔧  Actualizando webhooks.module.ts..."
cat > src/modules/webhooks/webhooks.module.ts << 'TSEOF'
import { BullModule }           from '@nestjs/bullmq';
import { Module }               from '@nestjs/common';
import { WebhooksController }   from './webhooks.controller';
import { WebhookProcessor }     from './webhook.processor';
import { WebhookSecretService } from './webhook-secret.service';
import { FirebaseModule }       from '../firebase/firebase.module';
import { TenantsModule }        from '../tenants/tenants.module';
import { FirebaseAuthService }  from '../firebase/firebase-auth.service';
import { AuthGuard }            from '../../common/guards/auth.guard';
import { TenantGuard }          from '../../common/guards/tenant.guard';
import { ApiKeyGuard }          from '../../common/guards/api-key.guard';
import { RolesGuard }           from '../../common/guards/roles.guard';
import { QUEUE_WEBHOOKS }       from '../../common/constants/queues';

@Module({
  imports: [
    FirebaseModule,
    TenantsModule,
    BullModule.registerQueue({ name: QUEUE_WEBHOOKS }),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhookProcessor,
    WebhookSecretService,
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
  ],
  exports: [WebhookSecretService],
})
export class WebhooksModule {}
TSEOF
echo "✅  webhooks.module.ts"

echo ""
echo "📄  payments.module.ts final:"
cat src/modules/payments/payments.module.ts
echo ""
echo "📄  webhooks.module.ts final:"
cat src/modules/webhooks/webhooks.module.ts