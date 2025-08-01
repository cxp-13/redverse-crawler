import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Redverse Crawler API',
      version: '1.0.0',
    };
  }

  @Get('info')
  getInfo() {
    return {
      name: 'Redverse Crawler API',
      version: '1.0.0',
      description: 'API for crawling Xiaohongshu note data',
      endpoints: {
        auth: '/auth',
        crawler: '/crawler',
        data: '/data',
        scheduler: '/scheduler',
      },
      documentation: 'API endpoints for managing Xiaohongshu data crawling',
    };
  }
}
