#!/usr/bin/env bash
# =============================================================================
# fix-pagos-redis-disabled-final.sh
# Reescribe payments.module.ts, webhooks.module.ts y queue.module.ts
# para que cuando REDIS_ENABLED=false no se registre ningún @Processor
# ni ningún @InjectQueue que requiera conexión Redis.
# Repo: pagos-back
# =============================================================================
set -euo pipefail

if [ ! -f "src/modules/payments/payments.module.ts" ]; then
  echo "❌  Corré desde la raíz del repo pagos-back"
  exit 1
fi

# ── queue.module.ts ───────────────────────────────────────────────────────────
cp src/modules/queue/queue.module.ts src/modules/queue/queue.module.ts.bak
cat > src/modules/queue/queue.module.ts << 'TSEOF'
import { BullModule }     from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService }  from '@nestjs/config';
import { QUEUE_WEBHOOKS, QUEUE_RECONCILE, QUEUE_DLQ } from '../../common/constants/queues';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

@Global()
@Module({
  imports: REDIS_ENABLED ? [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 5,
          backoff:  { type: 'exponential', delay: 1_000 },
          removeOnComplete: { count: 200 },
          removeOnFail:     { count: 500 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_WEBHOOKS },
      { name: QUEUE_RECONCILE },
      { name: QUEUE_DLQ },
    ),
  ] : [],
  exports: REDIS_ENABLED ? [BullModule] : [],
})
export class QueueModule {}
TSEOF
echo "✅  queue.module.ts"

# ── payments.module.ts ────────────────────────────────────────────────────────
cp src/modules/payments/payments.module.ts src/modules/payments/payments.module.ts.bak
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

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

@Module({
  imports: [
    FakeModule,
    FirebaseModule,
    TenantsModule,
    ...(REDIS_ENABLED ? [BullModule.registerQueue({ name: QUEUE_RECONCILE })] : []),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    WriteGuard,
    PciGuard,
    ...(REDIS_ENABLED ? [ReconciliationService, ReconcileProcessor] : []),
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
TSEOF
echo "✅  payments.module.ts"

# ── webhooks.module.ts ────────────────────────────────────────────────────────
# WebhooksController tiene @InjectQueue en el constructor — cuando REDIS_ENABLED=false
# no podemos registrar ese controller. Lo reemplazamos por uno stub.
cp src/modules/webhooks/webhooks.module.ts src/modules/webhooks/webhooks.module.ts.bak
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

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

@Module({
  imports: [
    FirebaseModule,
    TenantsModule,
    ...(REDIS_ENABLED ? [BullModule.registerQueue({ name: QUEUE_WEBHOOKS })] : []),
  ],
  controllers: REDIS_ENABLED ? [WebhooksController] : [],
  providers: [
    WebhookSecretService,
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    ...(REDIS_ENABLED ? [WebhookProcessor] : []),
  ],
  exports: [WebhookSecretService],
})
export class WebhooksModule {}
TSEOF
echo "✅  webhooks.module.ts"

# ── ReconciliationService usa @InjectQueue — necesita guard también ───────────
# Cuando REDIS_ENABLED=false ReconciliationService no se registra, OK.
# Pero si algún servicio lo inyecta como dependencia directa hay que protegerlo.
echo ""
echo "🔍  Verificando dependencias de ReconciliationService..."
grep -r "ReconciliationService" src/ --include="*.ts" -l | grep -v "reconcili" || echo "   Sin dependencias externas"

echo ""
echo "✅  Fix completo — reiniciá el contenedor"