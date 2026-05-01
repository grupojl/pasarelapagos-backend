import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { assertValidTransition } from './payment-state.machine';
import {
  QUEUE_RECONCILE,
  JOB_RECONCILE_PAYMENT,
} from '../../common/constants/queues';
import { PaymentStatus } from '@prisma/client';

export interface ReconcileJobData {
  paymentId: string;
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  pending:    PaymentStatus.PENDING,
  authorized: PaymentStatus.AUTHORIZED,
  captured:   PaymentStatus.CAPTURED,
  failed:     PaymentStatus.FAILED,
  cancelled:  PaymentStatus.CANCELLED,
  refunded:   PaymentStatus.REFUNDED,
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly PENDING_THRESHOLD_MIN = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    @InjectQueue(QUEUE_RECONCILE) private readonly queue: Queue<ReconcileJobData>,
  ) {}

  /**
   * Cada 5 minutos busca pagos PENDING > 30 min y los encola para reconciliar.
   * Configurable con RECONCILE_CRON env var.
   */
  @Cron(process.env.RECONCILE_CRON ?? CronExpression.EVERY_5_MINUTES)
  async schedulePendingReconciliation(): Promise<void> {
    const threshold = new Date(
      Date.now() - this.PENDING_THRESHOLD_MIN * 60 * 1_000,
    );

    const stale = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        externalId: { not: null },
        createdAt: { lt: threshold },
      },
      select: { id: true },
      take: 100, // batch seguro
    });

    if (stale.length === 0) return;

    this.logger.log(`Encolando ${stale.length} pagos para reconciliar...`);

    const jobs = stale.map(({ id }) => ({
      name: JOB_RECONCILE_PAYMENT,
      data: { paymentId: id },
      opts: {
        jobId: `reconcile:${id}`,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 5_000 },
      },
    }));

    await this.queue.addBulk(jobs);
  }

  /**
   * Reconcilia un pago específico consultando al provider.
   * Llamado por el ReconcileProcessor o manualmente.
   */
  async reconcileOne(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        externalId: true,
        providerId: true,
      },
    });

    if (!payment?.externalId) {
      this.logger.warn(`Pago ${paymentId} sin externalId, skip.`);
      return;
    }

    const provider = this.registry.get(payment.providerId);
    const result = await provider.retrieve(payment.externalId);
    const newStatus = STATUS_MAP[result.status];

    if (!newStatus || payment.status === newStatus) return;

    try {
      assertValidTransition(payment.status, newStatus);
    } catch {
      this.logger.warn(
        `Reconciliación: transición inválida ${payment.status} → ${newStatus} ` +
        `para payment ${paymentId}. Skip.`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: newStatus },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId,
          type: 'reconciliation.updated',
          payload: { from: payment.status, to: newStatus, raw: result.raw as any },
        },
      });
    });

    this.logger.log(
      `Reconciliado: ${paymentId} ${payment.status} → ${newStatus}`,
    );
  }
}
