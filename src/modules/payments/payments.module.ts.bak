import { BullModule }            from '@nestjs/bullmq';
import { Module }                from '@nestjs/common';
import { PaymentsController }    from './payments.controller';
import { PaymentsService }       from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileProcessor }    from './reconcile.processor';
import { FakeModule }            from '../providers/adapters/fake/fake.module';
import { FirebaseModule }        from '../firebase/firebase.module';
import { TenantsModule }         from '../tenants/tenants.module';
import { FirebaseAuthService }   from '../firebase/firebase-auth.service';
import { AuthGuard }             from '../../common/guards/auth.guard';
import { TenantGuard }           from '../../common/guards/tenant.guard';
import { ApiKeyGuard }           from '../../common/guards/api-key.guard';
import { RolesGuard }            from '../../common/guards/roles.guard';
import { WriteGuard }            from '../../common/guards/write.guard';
import { PciGuard }              from '../../common/guards/pci.guard';
import { QUEUE_RECONCILE }       from '../../common/constants/queues';

@Module({
  imports: [
    FakeModule,
    FirebaseModule,
    TenantsModule,
    BullModule.registerQueue({ name: QUEUE_RECONCILE }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ReconciliationService,
    ReconcileProcessor,
    FirebaseAuthService,
    AuthGuard,
    TenantGuard,
    ApiKeyGuard,
    RolesGuard,
    WriteGuard,
    PciGuard,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
