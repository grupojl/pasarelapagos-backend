// src/modules/queue/queue.module.ts
// REDIS_ENABLED=true  → BullModule activo
// REDIS_ENABLED=false → sin BullModule (dev sin Redis)
import { BullModule }     from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService }  from '@nestjs/config';
import { QUEUE_WEBHOOKS, QUEUE_RECONCILE, QUEUE_DLQ } from '../../common/constants/queues';

const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true';

const bullImports = REDIS_ENABLED ? [
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
] : [];

@Global()
@Module({
  imports: bullImports,
  exports: REDIS_ENABLED ? [BullModule] : [],   // ← solo exporta si está importado
})
export class QueueModule {}
