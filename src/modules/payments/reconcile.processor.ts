import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReconciliationService, ReconcileJobData } from './reconciliation.service';
import { QUEUE_RECONCILE } from '../../common/constants/queues';

@Processor(QUEUE_RECONCILE, { concurrency: 3 })
export class ReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconcileProcessor.name);

  constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  async process(job: Job<ReconcileJobData>): Promise<void> {
    this.logger.debug(`Reconciliando pago: ${job.data.paymentId}`);
    await this.reconciliation.reconcileOne(job.data.paymentId);
  }
}
