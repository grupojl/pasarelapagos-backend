import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Tenant } from '../../common/decorators/tenant.decorator';
import type { TenantContext } from '../../common/decorators/tenant.decorator';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApiKeyService } from './api-key.service';

class CreateApiKeyDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

@ApiTags('tenants')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'tenants/me/api-keys', version: '1' })
export class TenantsController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  create(@Tenant() t: TenantContext, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(t.id, dto.label, dto.expiresInDays);
  }

  @Get()
  list(@Tenant() t: TenantContext) {
    return this.apiKeys.list(t.id);
  }

  @Delete(':keyId')
  revoke(@Tenant() t: TenantContext, @Param('keyId') keyId: string) {
    return this.apiKeys.revoke(keyId, t.id);
  }
}
