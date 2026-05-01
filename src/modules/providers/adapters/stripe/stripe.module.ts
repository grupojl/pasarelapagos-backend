import { Module } from '@nestjs/common';
import { StripeProvider } from './stripe.provider';
import { CircuitBreakerService } from '../../circuit-breaker.service';

@Module({
  providers: [StripeProvider, CircuitBreakerService],
  exports: [StripeProvider],
})
export class StripeModule {}
