import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { Public } from '../../common/decorators/public.decorator';
import { QUEUE_WEBHOOKS, JOB_PROCESS_WEBHOOK } from '../../common/constants/queues';
import { WebhookJobData } from './webhook.processor';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly registry:    ProviderRegistry,
    private readonly prisma:      PrismaService,
    @InjectQueue(QUEUE_WEBHOOKS)
    private readonly webhookQueue: Queue<WebhookJobData>,
  ) {}

  @Public()
  @Post(':providerId')
  @HttpCode(200)
  async handle(
    @Param('providerId') providerId: string,
    @Req() req: any,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    const start = Date.now();

    const provider = this.registry.get(providerId);

    let event: Awaited<ReturnType<typeof provider.verifyWebhook>>;
    try {
      event = await provider.verifyWebhook(
        req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
        headers,
      );
    } catch (err: any) {
      this.logger.warn(`Firma inválida de ${providerId}: ${err.message}`);
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    // Dedup
    const existing = await this.prisma.webhookInbound.findUnique({
      where: { providerId_externalId: { providerId, externalId: event.externalId } },
    });
    if (existing) {
      this.logger.debug(`Webhook duplicado ignorado: ${providerId}/${event.externalId}`);
      return { received: true };
    }

    // Persistir
    const inbound = await this.prisma.webhookInbound.create({
      data: {
        providerId,
        externalId: event.externalId,
        headers:    headers as any,
        body:       event.raw as any,
        status:     'received',
      },
    });

    // Encolar con timestamp para calcular lag en el worker
    await this.webhookQueue.add(
      JOB_PROCESS_WEBHOOK,
      { webhookInboundId: inbound.id, event, enqueuedAt: Date.now() },
      {
        jobId:    `webhook:${providerId}:${event.externalId}`,
        attempts: 5,
        backoff:  { type: 'exponential', delay: 2_000 },
      },
    );

    this.logger.log(
      `Webhook encolado: ${providerId}/${event.eventType} (${Date.now() - start}ms)`,
    );

    return { received: true };
  }
}
