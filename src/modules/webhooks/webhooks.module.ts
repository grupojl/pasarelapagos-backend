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
