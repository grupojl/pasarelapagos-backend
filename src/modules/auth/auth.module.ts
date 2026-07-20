import { Module }              from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { FirebaseModule }      from '../firebase/firebase.module';
import { TenantsModule }       from '../tenants/tenants.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';

@Module({
  imports:     [FirebaseModule, TenantsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService],
  exports:     [FirebaseAuthService],
})
export class AuthModule {}
