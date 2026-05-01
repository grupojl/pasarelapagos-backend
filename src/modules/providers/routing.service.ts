import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentProvider } from './provider.interface';
import { ProviderRegistry } from './provider.registry';
import { CircuitBreakerService } from './circuit-breaker.service';

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutos
const CACHE_KEY    = (country: string, currency: string, method: string) =>
  `route:${country}:${currency}:${method}`;

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly registry:  ProviderRegistry,
    private readonly cb:        CircuitBreakerService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Selecciona el mejor provider para (country, currency, method).
   *
   * Estrategia:
   *  1. Leer rutas de DB ordenadas por prioridad DESC (con cache 5min).
   *  2. Filtrar providers con circuit breaker cerrado.
   *  3. Retornar el primero disponible.
   *  4. Si ninguno está disponible → fallback al registry en memoria.
   */
  async selectProvider(
    country: string,
    currency: string,
    method: string,
  ): Promise<PaymentProvider> {
    const cacheKey = CACHE_KEY(country, currency, method);
    let providerIds = await this.cache.get<string[]>(cacheKey);

    if (!providerIds) {
      const routes = await this.prisma.providerRoute.findMany({
        where:   { country, currency, method: method as any, active: true },
        orderBy: { priority: 'desc' },
        select:  { providerId: true },
      });

      providerIds = routes.map((r) => r.providerId);
      await this.cache.set(cacheKey, providerIds, CACHE_TTL_MS);
      this.logger.debug(
        `Cache miss para ${cacheKey}: [${providerIds.join(', ')}]`,
      );
    }

    // Buscar el primer provider con CB cerrado
    for (const id of providerIds) {
      const health = this.cb.healthOf(`${id}:createCharge`);
      if (health === 'closed' || health === 'unknown') {
        try {
          return this.registry.get(id);
        } catch {
          this.logger.warn(`Provider ${id} en DB pero no registrado en memoria.`);
        }
      } else {
        this.logger.warn(
          `Provider ${id} tiene circuit breaker ${health}, saltando.`,
        );
      }
    }

    // Fallback: buscar en el registry sin restricción de CB
    this.logger.warn(
      `Sin provider disponible en DB para ${country}/${currency}. Usando fallback del registry.`,
    );
    try {
      return this.registry.selectFor(country, currency);
    } catch {
      throw new NotFoundException(
        `Sin provider disponible para ${country}/${currency}/${method}`,
      );
    }
  }

  /** Invalida el cache de rutas para un país/moneda específico */
  async invalidateRoute(country: string, currency: string, method: string) {
    await this.cache.del(CACHE_KEY(country, currency, method));
    this.logger.log(`Cache invalidado: ${CACHE_KEY(country, currency, method)}`);
  }
}
