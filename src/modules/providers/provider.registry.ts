import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from './provider.interface';

/**
 * Registro en memoria. Cada adapter se registra en su onModuleInit.
 * Ruteo: selectFor(country, currency, method) → primer provider que matchee.
 * Estrategia extendible: prioridades, health, A/B por tier, etc.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider) {
    if (this.providers.has(provider.id)) {
      this.logger.warn(`Provider ${provider.id} ya estaba registrado, overwrite.`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(`Provider registrado: ${provider.id} (${provider.countries.join(',')})`);
  }

  get(id: string): PaymentProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Provider no registrado: ${id}`);
    return p;
  }

  selectFor(country: string, currency: string): PaymentProvider {
    for (const p of this.providers.values()) {
      if (p.countries.includes(country) && p.currencies.includes(currency)) return p;
    }
    throw new Error(`Sin provider para ${country}/${currency}`);
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
