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
