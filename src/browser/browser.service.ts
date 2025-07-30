import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer from 'puppeteer-extra';
import { Browser, Page } from 'puppeteer';

// 动态导入 stealth 插件
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;

  constructor(private configService: ConfigService) {
    // 添加 stealth 插件
    puppeteer.use(StealthPlugin());
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.log('Launching new browser instance');
      
      // 浏览器启动参数
      const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ];

      // 正确处理环境变量的布尔值转换
      const headlessEnv = this.configService.get<string>('PUPPETEER_HEADLESS', 'false');
      const isHeadless = headlessEnv.toLowerCase() === 'true';
      
      this.logger.log(`Browser launching with headless: ${isHeadless}`);
      
      this.browser = await puppeteer.launch({
        headless: isHeadless,
        args: args,
        defaultViewport: {
          width: 1920,
          height: 1080,
        },
        ignoreDefaultArgs: ['--enable-automation'],
      });

      this.browser.on('disconnected', () => {
        this.logger.warn('Browser disconnected');
        this.browser = null;
      });
    }

    return this.browser;
  }

  async createPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // 设置更真实的用户代理
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );

    // 设置基本的 HTTP 头
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    });

    // 移除 webdriver 属性
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    // 模拟真实的屏幕和视口
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false,
    });

    this.logger.log('Page created with optimized rendering settings');
    return page;
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      this.logger.log('Closing browser');
      await this.browser.close();
      this.browser = null;
    }
  }
}