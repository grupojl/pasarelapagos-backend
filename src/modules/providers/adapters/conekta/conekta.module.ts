import { Module } from '@nestjs/common';
import { ConektaProvider } from './conekta.provider';

@Module({
  providers: [ConektaProvider],
  exports: [ConektaProvider],
})
export class ConektaModule {}
