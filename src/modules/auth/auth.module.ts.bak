// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { FirebaseModule } from '../firebase/firebase.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';

@Module({
  imports:     [FirebaseModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService],
  exports:     [FirebaseAuthService],
})
export class AuthModule {}
