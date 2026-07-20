// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { FirebaseModule }      from '../firebase/firebase.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';
import { TenantsModule }       from '../tenants/tenants.module';
import { AuthGuard }           from '../../common/guards/auth.guard';

@Module({
  imports:     [FirebaseModule, TenantsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService, AuthGuard],
  exports:     [FirebaseAuthService, AuthGuard],
})
export class AuthModule {}
