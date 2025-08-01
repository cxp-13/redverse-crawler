import { Module } from '@nestjs/common';
import { DataUpdateService } from './data-update.service';
import { AuthModule } from '../auth/auth.module';
import { CrawlerModule } from '../crawler/crawler.module';
import { SupabaseService } from '../lib/supabase';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { ClerkModule } from '../clerk/clerk.module';

@Module({
  imports: [AuthModule, CrawlerModule, RedisModule, EmailModule, ClerkModule],
  providers: [DataUpdateService, SupabaseService],
  exports: [DataUpdateService],
})
export class DataUpdateModule {}
