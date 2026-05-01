import { Module } from '@nestjs/common';
import { PagarmeProvider } from './pagarme.provider';

@Module({
  providers: [PagarmeProvider],
  exports: [PagarmeProvider],
})
export class PagarmeModule {}
