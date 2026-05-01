import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { assertValidTransition } from '../payments/payment-state.machine';
import { QUEUE_WEBHOOKS } from '../../common/constants/queues';
import { WebhookEvent } from '../providers/provider.interface';
import { PaymentStatus } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';

export interface WebhookJobData {
  webhookInboundId: string;
  event: WebhookEvent;
  enqueuedAt: number; // timestamp para calcular lag
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  pending:    PaymentStatus.PENDING,
  authorized: PaymentStatus.AUTHORIZED,
  captured:   PaymentStatus.CAPTURED,
  failed:     PaymentStatus.FAILED,
  cancelled:  PaymentStatus.CANCELLED,
  refunded:   PaymentStatus.REFUNDED,
};

@Processor(QUEUE_WEBHOOKS, {
  concurrency: 5,
  limiter: { max: 50, duration: 1_000 },
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly metrics:  MetricsService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { webhookInboundId, event, enqueuedAt } = job.data;
    const lagMs = Date.now() - (enqueuedAt ?? Date.now());

    this.logger.log(
      `Procesando webhook ${event.providerId}/${event.eventType} ` +
      `externalId=${event.externalId} lag=${lagMs}ms attempt=${job.attemptsMade + 1}`,
    );

    const payment = await this.prisma.payment.findFirst({
      where: { externalId: event.externalId, providerId: event.providerId },
    });

    if (!payment) {
      this.logger.warn(`Payment no encontrado: ${event.externalId} — se reintentará.`);
      throw new Error(`Payment no encontrado: ${event.externalId}`);
    }

    const newStatus = STATUS_MAP[event.status];
    if (!newStatus) {
      this.logger.warn(`Status desconocido: ${event.status}`);
      await this.markProcessed(webhookInboundId);
      return;
    }

    if (payment.status === newStatus) {
      this.logger.debug(`Estado ya es ${newStatus}, skip idempotente.`);
      await this.markProcessed(webhookInboundId);
      this.metrics.recordWebhook({ provider: event.providerId, status: 'processed', lagMs });
      return;
    }

    assertValidTransition(payment.status, newStatus);

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data:  { status: newStatus },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          type:      `webhook.${event.eventType}`,
          payload:   event.raw as any,
        },
      });
    });

    await this.markProcessed(webhookInboundId);
    this.metrics.recordWebhook({ provider: event.providerId, status: 'processed', lagMs });

    this.logger.log(`Payment ${payment.id}: ${payment.status} → ${newStatus}`);
  }

  private async markProcessed(id: string) {
    await this.prisma.webhookInbound.update({
      where: { id },
      data:  { status: 'processed', processedAt: new Date() },
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobData>, err: Error) {
    this.logger.error(`Job ${job.id} falló (attempt ${job.attemptsMade}): ${err.message}`);
    this.metrics.recordWebhook({
      provider: job.data.event?.providerId ?? 'unknown',
      status: 'failed',
      lagMs: Date.now() - (job.data.enqueuedAt ?? Date.now()),
    });
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} está stalled.`);
  }
}
