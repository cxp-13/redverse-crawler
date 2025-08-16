import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseService } from './lib/supabase';
import { AuthModule } from './auth/auth.module';
import { CrawlerModule } from './crawler/crawler.module';
import { BrowserModule } from './browser/browser.module';
import { DataUpdateModule } from './data-update/data-update.module';
import { RedisModule } from './redis/redis.module';
import { ProgressModule } from './progress/progress.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    BrowserModule,
    AuthModule,
    CrawlerModule,
    DataUpdateModule,
    ProgressModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService, SupabaseService],
})
export class AppModule {}
