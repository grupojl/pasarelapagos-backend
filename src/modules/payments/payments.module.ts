import { BullModule }            from '@nestjs/bullmq';
import { Module }                from '@nestjs/common';
import { PaymentsController }    from './payments.controller';
import { PaymentsService }       from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileProcessor }    from './reconcile.processor';
import { FakeModule }            from '../providers/adapters/fake/fake.module';
import { QUEUE_RECONCILE }       from '../../common/constants/queues';

@Module({
  imports: [
    FakeModule,
    BullModule.registerQueue({ name: QUEUE_RECONCILE }),
  ],
  controllers: [PaymentsController],
  providers:   [PaymentsService, ReconciliationService, ReconcileProcessor],
  exports:     [PaymentsService],
})
export class PaymentsModule {}
