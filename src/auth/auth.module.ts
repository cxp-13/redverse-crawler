import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { BrowserModule } from '../browser/browser.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [BrowserModule, RedisModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}