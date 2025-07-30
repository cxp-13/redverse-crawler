import { Module } from '@nestjs/common';
import { ClerkService } from './clerk.service';

@Module({
  providers: [ClerkService],
  exports: [ClerkService],
})
export class ClerkModule {}