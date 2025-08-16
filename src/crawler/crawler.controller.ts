import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { CrawlerService } from './crawler.service';

@Controller('crawler')
export class CrawlerController {
  constructor(private crawlerService: CrawlerService) {}

  @Post('crawl')
  async crawlNote(@Body() body: { appName: string }) {
    const { appName } = body;

    if (!appName) {
      throw new HttpException(
        {
          success: false,
          message: 'App name parameter cannot be empty',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const isValidAppName = this.crawlerService.validateAppName(appName);
    if (!isValidAppName) {
      throw new HttpException(
        {
          success: false,
          message: 'Invalid app name',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.crawlerService.crawlNoteDataByAppName(appName);
      return {
        success: result.success,
        message: result.success ? 'Crawl successful' : 'Crawl failed',
        data: result.data,
        error: result.error,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: 'Error occurred during crawling',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
