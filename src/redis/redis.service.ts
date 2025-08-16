import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

interface LoginStatus {
  loginStatus:
    | 'idle'
    | 'logging_in'
    | 'waiting_sms_code'
    | 'logged_in'
    | 'failed';
  updateStatus: 'idle' | 'updating' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    failed: number;
  };
  lastUpdate?: Date;
  error?: string;
}

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private redis: Redis;
  private readonly PROGRESS_KEY = 'crawler:progress';

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const token = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (!url || !token) {
      this.logger.error(
        'Missing Redis configuration: URL or TOKEN not provided',
      );
      throw new Error('Redis URL and Token must be provided');
    }

    try {
      this.redis = new Redis({
        url: url,
        token: token,
      });
      this.logger.log('Redis client initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
      throw error;
    }
  }

  // 设置进度数据，24小时自动过期
  async setProgress(data: LoginStatus): Promise<void> {
    try {
      const serializedData = JSON.stringify(data, (key, value) => {
        // 将Date对象转换为ISO字符串
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value as unknown;
      });

      await this.redis.setex(this.PROGRESS_KEY, 86400, serializedData); // 24小时TTL
    } catch (error) {
      this.logger.error('Failed to save progress to Redis:', error);
      this.logger.error(
        'Data that failed to serialize:',
        JSON.stringify(data, null, 2),
      );
      throw error;
    }
  }

  // 获取进度数据
  async getProgress(): Promise<LoginStatus | null> {
    try {
      const data = await this.redis.get(this.PROGRESS_KEY);
      if (!data) {
        return null;
      }

      let dataString: string;

      // 处理不同类型的返回数据
      if (typeof data === 'string') {
        dataString = data;
      } else if (typeof data === 'object' && data !== null) {
        // 如果Upstash返回的是对象而不是字符串，直接使用
        const progress = data as unknown as LoginStatus;
        // 处理lastUpdate字段
        if (progress.lastUpdate && typeof progress.lastUpdate === 'string') {
          progress.lastUpdate = new Date(progress.lastUpdate);
        }
        return progress;
      } else {
        dataString =
          typeof data === 'object' && data !== null
            ? JSON.stringify(data)
            : '[non-object]';
      }

      // 使用JSON.parse的reviver函数正确处理日期字符串
      const progress = JSON.parse(dataString, (key, value) => {
        // 如果是lastUpdate字段并且是字符串，尝试转换为Date对象
        if (key === 'lastUpdate' && typeof value === 'string') {
          return new Date(value);
        }
        return value as unknown;
      }) as LoginStatus;

      return progress;
    } catch (error) {
      this.logger.error('Failed to retrieve progress from Redis:');
      this.logger.error(
        `Error details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.logger.error(
        `Stack: ${error instanceof Error ? error.stack : 'No stack trace'}`,
      );
      return null;
    }
  }

  // 删除进度数据
  async deleteProgress(): Promise<void> {
    try {
      await this.redis.del(this.PROGRESS_KEY);
      this.logger.log('Progress data deleted from Redis');
    } catch (error) {
      this.logger.error('Failed to delete progress from Redis:', error);
      throw error;
    }
  }

  // 检查Redis连接状态
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }
}
