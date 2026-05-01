import { Module } from '@nestjs/common';
import { MercadoPagoProvider } from './mercadopago.provider';

@Module({
  providers: [MercadoPagoProvider],
  exports: [MercadoPagoProvider],
})
export class MercadoPagoModule {}
