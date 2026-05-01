import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ProviderRegistry } from './provider.registry';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RoutingService } from './routing.service';
// Adapters
import { StripeModule } from './adapters/stripe/stripe.module';
import { MercadoPagoModule } from './adapters/mercadopago/mercadopago.module';
import { PagarmeModule } from './adapters/pagarme/pagarme.module';
import { ConektaModule } from './adapters/conekta/conekta.module';
import { DlocalModule } from './adapters/dlocal/dlocal.module';

@Global()
@Module({
  imports: [
    CacheModule.register({ ttl: 5 * 60 * 1000, max: 100 }),
    StripeModule,
    MercadoPagoModule,
    PagarmeModule,
    ConektaModule,
    DlocalModule,
  ],
  providers: [
    ProviderRegistry,
    CircuitBreakerService,
    RoutingService,
  ],
  exports: [
    ProviderRegistry,
    CircuitBreakerService,
    RoutingService,
  ],
})
export class ProvidersModule {}
