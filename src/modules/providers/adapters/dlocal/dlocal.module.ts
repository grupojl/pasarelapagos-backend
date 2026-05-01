import { Module } from '@nestjs/common';
import { DlocalProvider } from './dlocal.provider';

@Module({
  providers: [DlocalProvider],
  exports: [DlocalProvider],
})
export class DlocalModule {}
