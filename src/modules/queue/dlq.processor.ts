import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_DLQ } from '../../common/constants/queues';

/**
 * Recibe jobs que agotaron sus reintentos.
 * En producción: conectar a Slack/PagerDuty/Sentry para alertas.
 */
@Processor(QUEUE_DLQ)
export class DlqProcessor extends WorkerHost {
  private readonly logger = new Logger(DlqProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.error(
      `⚠️  DLQ — Job sin procesar: queue=${job.queueName} ` +
      `id=${job.id} data=${JSON.stringify(job.data)}`,
    );
    // TODO Sprint 5: emit evento a OpenTelemetry / Slack webhook / Sentry
  }
}
