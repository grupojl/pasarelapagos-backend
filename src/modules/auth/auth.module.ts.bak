// src/modules/auth/auth.module.ts
import { Module }              from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { SharedGuardsModule }  from '../../common/shared-guards.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';

@Module({
  imports:     [SharedGuardsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService],
  exports:     [FirebaseAuthService, SharedGuardsModule],
})
export class AuthModule {}
