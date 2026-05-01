import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { PaymentException } from '../../common/errors/payment.exception';
import { PaymentErrorCode } from '../../common/errors/payment-error.catalog';

export interface CircuitBreakerOptions {
  timeout?: number;       // ms antes de considerar fallido (default: 5000)
  errorThreshold?: number;// % de errores para abrir (default: 50)
  resetTimeout?: number;  // ms hasta intentar half-open (default: 30000)
  volumeThreshold?: number;// mínimo de requests para evaluar (default: 5)
}

@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Ejecuta `fn` protegido por un circuit breaker identificado por `key`.
   * Si el breaker está abierto lanza PROVIDER_UNAVAILABLE inmediatamente.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    options: CircuitBreakerOptions = {},
  ): Promise<T> {
    const breaker = this.getOrCreate(key, fn, options);
    try {
      return await breaker.fire();
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        this.logger.warn(`Circuit breaker ABIERTO para: ${key}`);
        throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE);
      }
      if (err?.name === 'TimeoutError') {
        throw new PaymentException(PaymentErrorCode.PROVIDER_TIMEOUT);
      }
      throw err;
    }
  }

  healthOf(key: string): 'closed' | 'open' | 'halfOpen' | 'unknown' {
    const b = this.breakers.get(key);
    if (!b) return 'unknown';
    if (b.opened)    return 'open';
    if (b.halfOpen)  return 'halfOpen';
    return 'closed';
  }

  statsOf(key: string) {
    return this.breakers.get(key)?.stats ?? null;
  }

  onModuleDestroy() {
    for (const [, b] of this.breakers) b.shutdown();
  }

  private getOrCreate<T>(
    key: string,
    fn: () => Promise<T>,
    opts: CircuitBreakerOptions,
  ): CircuitBreaker<[], T> {
    if (this.breakers.has(key)) {
      // Actualizar la acción si cambió (p.ej. provider reconfigurado)
      const existing = this.breakers.get(key)!;
      (existing as any).action = fn;
      return existing as CircuitBreaker<[], T>;
    }

    const breaker = new CircuitBreaker(fn, {
      timeout:          opts.timeout         ?? 10_000,
      errorThresholdPercentage: opts.errorThreshold  ?? 50,
      resetTimeout:     opts.resetTimeout    ?? 30_000,
      volumeThreshold:  opts.volumeThreshold ?? 5,
      name:             key,
    });

    breaker.on('open',     () => this.logger.warn(`[CB] ABIERTO: ${key}`));
    breaker.on('halfOpen', () => this.logger.log(`[CB] HALF-OPEN: ${key}`));
    breaker.on('close',    () => this.logger.log(`[CB] CERRADO (recuperado): ${key}`));
    breaker.on('fallback', () => this.logger.warn(`[CB] fallback activado: ${key}`));

    this.breakers.set(key, breaker as CircuitBreaker);
    return breaker;
  }
}
