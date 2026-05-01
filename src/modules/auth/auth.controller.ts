// src/modules/auth/auth.controller.ts
// Este sistema NO gestiona users ni orgs — eso lo hace el owner-dashboard.
// Solo expone endpoints de utilidad para el contexto SSO.
import {
  Controller,
  Get,
  Post,
  Headers,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrgCtx } from '../../common/decorators/org.decorator';
import type { OrgContext } from '../../common/interfaces/org-context.interface';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('auth')
@ApiBearerAuth()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly firebase: FirebaseAuthService) {}

  /**
   * GET /api/v1/auth/me
   * Retorna el contexto del usuario actual en esta org.
   * El frontend lo usa para saber si tiene acceso a este módulo.
   */
  @UseGuards(AuthGuard, TenantGuard)
  @ApiHeader({ name: 'x-organization-id', required: true })
  @Get('me')
  me(@OrgCtx() ctx: OrgContext) {
    return {
      organizationId: ctx.organizationId,
      userId:         ctx.userId,
      canRead:        ctx.canRead,
      canWrite:       ctx.canWrite,
      product:        'payments',
    };
  }

  /**
   * POST /api/v1/auth/verify
   * Verifica que un token Firebase es válido en este sistema.
   * Útil para health checks de integración SSO.
   */
  @Public()
  @Post('verify')
  async verify(@Headers('authorization') authHeader: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta Bearer token');
    }

    const token   = authHeader.slice(7);
    const decoded = await this.firebase.verifyToken(token);

    return {
      valid:          true,
      uid:            decoded.uid,
      email:          decoded.email,
      hasPaymentsAccess: !!(
        decoded.productPermissions?.['payments']?.canRead
      ),
    };
  }
}
