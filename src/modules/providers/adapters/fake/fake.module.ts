import { Module } from '@nestjs/common';
import { FakeProvider } from './fake.provider';

@Module({
  providers: [FakeProvider],
})
export class FakeModule {}
