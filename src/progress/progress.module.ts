import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ProgressController } from './progress.controller';

@Module({
  imports: [RedisModule],
  controllers: [ProgressController],
})
export class ProgressModule {}