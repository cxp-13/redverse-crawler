import { Controller, Get, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

interface LoginStatus {
  loginStatus: 'idle' | 'logging_in' | 'waiting_sms_code' | 'logged_in' | 'failed';
  updateStatus: 'idle' | 'updating' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    failed: number;
  };
  lastUpdate?: Date;
  error?: string;
}

@Controller('progress')
export class ProgressController {
  private readonly logger = new Logger(ProgressController.name);

  constructor(private redisService: RedisService) {}

  @Get('clear')
  async clearProgress(): Promise<{ success: boolean; message: string }> {
    try {
      await this.redisService.deleteProgress();
      this.logger.log('🧹 Progress data cleared from Redis');
      return {
        success: true,
        message: 'Progress data cleared successfully',
      };
    } catch (error) {
      this.logger.error('Failed to clear progress:', error);
      return {
        success: false,
        message: 'Failed to clear progress data',
      };
    }
  }

  @Get()
  async getProgress(): Promise<{ success: boolean; data?: LoginStatus; error?: string }> {
    try {
      this.logger.log('📊 Progress API called');
      const progress = await this.redisService.getProgress();
      
      if (!progress) {
        this.logger.log('📊 No progress data found, returning default state');
        // 返回默认状态
        const defaultState = {
          loginStatus: 'idle' as const,
          updateStatus: 'idle' as const,
          progress: {
            total: 0,
            processed: 0,
            failed: 0,
          },
        };
        return {
          success: true,
          data: defaultState,
        };
      }

      this.logger.log(`📊 Progress data retrieved successfully: status=${progress.loginStatus}/${progress.updateStatus}, progress=${JSON.stringify(progress.progress)}`);
      return {
        success: true,
        data: progress,
      };
    } catch (error) {
      this.logger.error('❌ Failed to get progress:', error);
      // 返回默认状态而不是错误
      const fallbackState = {
        loginStatus: 'idle' as const,
        updateStatus: 'idle' as const,
        progress: {
          total: 0,
          processed: 0,
          failed: 0,
        },
      };
      return {
        success: true,
        data: fallbackState,
      };
    }
  }
}