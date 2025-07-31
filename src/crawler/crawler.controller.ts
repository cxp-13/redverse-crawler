import { Controller, Post, Body, HttpStatus, HttpException } from '@nestjs/common';
import { CrawlerService } from './crawler.service';

@Controller('crawler')
export class CrawlerController {
  constructor(private crawlerService: CrawlerService) {}

  @Post('crawl')
  async crawlNote(@Body() body: { appName: string }) {
    const { appName } = body;

    if (!appName) {
      throw new HttpException({
        success: false,
        message: '应用名称参数不能为空',
      }, HttpStatus.BAD_REQUEST);
    }

    const isValidAppName = this.crawlerService.validateAppName(appName);
    if (!isValidAppName) {
      throw new HttpException({
        success: false,
        message: '无效的应用名称',
      }, HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.crawlerService.crawlNoteDataByAppName(appName);
      return {
        success: result.success,
        message: result.success ? '爬取成功' : '爬取失败',
        data: result.data,
        error: result.error,
      };
    } catch (error) {
      throw new HttpException({
        success: false,
        message: '爬取过程中发生错误',
        error: error.message,
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}