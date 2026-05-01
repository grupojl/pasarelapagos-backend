import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Endpoints de health para Kubernetes / load balancers / Railway / Render.
 *
 * GET /api/v1/health/live  → liveness:  ¿está el proceso vivo?
 * GET /api/v1/health/ready → readiness: ¿puede recibir tráfico?
 * GET /api/v1/health       → full check (alias de /ready)
 */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health:       HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma:       PrismaService,
    @Inject(REDIS_CLIENT)
    private readonly redis:        Redis,
  ) {}

  /** Liveness: siempre 200 si el proceso responde */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: chequea DB + Redis */
  @Public()
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      // 1. Postgres
      () => this.prismaHealth.pingCheck('postgres', this.prisma),

      // 2. Redis
      async () => {
        const start  = Date.now();
        const pong   = await this.redis.ping();
        const latency = Date.now() - start;
        const isOk   = pong === 'PONG';
        return {
          redis: {
            status:  isOk ? 'up' : 'down',
            latency: `${latency}ms`,
          },
        };
      },
    ]);
  }

  /** Full check (alias de /ready) */
  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.ready();
  }
}
