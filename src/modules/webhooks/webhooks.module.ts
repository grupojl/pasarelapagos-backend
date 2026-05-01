import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookProcessor } from './webhook.processor';
import { WebhookSecretService } from './webhook-secret.service';
import { QUEUE_WEBHOOKS } from '../../common/constants/queues';

@Module({
  imports: [
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
