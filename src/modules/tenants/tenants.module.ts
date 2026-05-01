import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { TenantsController } from './tenants.controller';

@Module({
  providers:   [ApiKeyService],
  controllers: [TenantsController],
  exports:     [ApiKeyService],
})
export class TenantsModule {}
