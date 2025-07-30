import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page } from 'puppeteer';
import { AuthService } from '../auth/auth.service';

interface CrawlResult {
  success: boolean;
  data?: {
    likes_count: number;
    collects_count: number;
    comments_count: number;
    views_count: number;
    shares_count: number;
    title?: string;
    author?: string;
  };
  error?: string;
}

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  async crawlNoteData(url: string): Promise<CrawlResult> {
    const page = await this.authService.getAuthenticatedPage();
    
    if (!page) {
      return {
        success: false,
        error: '未登录，无法爬取数据',
      };
    }

    try {
      this.logger.log(`Starting to crawl note: ${url}`);
      
      // 清理页面内容，准备访问新URL（但不关闭页面）
      await this.authService.cleanPageForNewUrl(page);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // 等待页面加载完成
      await this.waitForPageLoad(page);

      // 使用多重选择器策略提取数据
      const data = await this.extractNoteData(page);

      this.logger.log(`Successfully crawled note data: ${JSON.stringify(data)}`);

      return {
        success: true,
        data,
      };

    } catch (error) {
      this.logger.error(`Failed to crawl note ${url}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
    // 注意：不再关闭page，让AuthService管理页面生命周期
  }

  private async waitForPageLoad(page: Page): Promise<void> {
    try {
      // 等待主要内容容器加载
      await Promise.race([
        page.waitForSelector('#noteContainer', { timeout: 15000 }),
        page.waitForSelector('.note-detail-container', { timeout: 15000 }),
        page.waitForSelector('[data-testid="note-content"]', { timeout: 15000 }),
      ]);

      // 额外等待交互数据加载
      await page.waitForTimeout(3000);
    } catch (error) {
      this.logger.warn('Page load timeout, proceeding with extraction');
    }
  }

  private async extractNoteData(page: Page): Promise<{
    likes_count: number;
    collects_count: number;
    comments_count: number;
    views_count: number;
    shares_count: number;
    title?: string;
    author?: string;
  }> {
    const data = {
      likes_count: 0,
      collects_count: 0,
      comments_count: 0,
      views_count: 0,
      shares_count: 0,
      title: undefined as string | undefined,
      author: undefined as string | undefined,
    };

    // 提取点赞数 - 使用用户提供的精确XPath
    data.likes_count = await this.extractCount(page, [
      '//*[@id="noteContainer"]/div[4]/div[3]/div/div/div[1]/div[2]/div/div[1]/span[1]/span[2]', // 用户提供的精确XPath
      '.like-count .count',
      '[data-testid="like-count"]',
      '.interact-item:first-child .count',
    ]);

    // 提取收藏数 - 使用用户提供的精确XPath
    data.collects_count = await this.extractCount(page, [
      '//*[@id="note-page-collect-board-guide"]/span', // 用户提供的精确XPath
      '.collect-count .count',
      '[data-testid="collect-count"]',
      '.interact-item:nth-child(2) .count',
    ]);

    // 提取评论数 - 使用用户提供的精确XPath
    data.comments_count = await this.extractCount(page, [
      '//*[@id="noteContainer"]/div[4]/div[3]/div/div/div[1]/div[2]/div/div[1]/span[3]/span', // 用户提供的精确XPath
      '.comment-count .count',
      '[data-testid="comment-count"]',
      '.interact-item:nth-child(3) .count',
    ]);

    // 提取浏览数
    data.views_count = await this.extractCount(page, [
      '.view-count .count',
      '[data-testid="view-count"]',
      'span:contains("浏览") + span',
      'span:contains("观看") + span',
    ]);

    // 提取分享数
    data.shares_count = await this.extractCount(page, [
      '.share-count .count',
      '[data-testid="share-count"]',
      'span:contains("分享") + span',
    ]);

    // 提取标题
    data.title = await this.extractText(page, [
      '.note-detail-title',
      '.note-title',
      'h1',
      '[data-testid="note-title"]',
      '.content-title',
    ]);

    // 提取作者
    data.author = await this.extractText(page, [
      '.user-name',
      '.author-name',
      '[data-testid="author-name"]',
      '.user-info .name',
      '.avatar-container + .name',
    ]);

    return data;
  }

  private async extractCount(page: Page, selectors: string[]): Promise<number> {
    for (const selector of selectors) {
      try {
        let element;
        
        if (selector.startsWith('//')) {
          // XPath选择器
          const elements = await page.$x(selector);
          element = elements[0];
        } else {
          // CSS选择器
          element = await page.$(selector);
        }

        if (element) {
          const text = await page.evaluate(el => el.textContent?.trim() || '', element);
          const count = this.parseCount(text);
          if (count >= 0) {
            this.logger.debug(`Extracted count ${count} using selector: ${selector}`);
            return count;
          }
        }
      } catch (error) {
        this.logger.debug(`Selector failed: ${selector}, error: ${error.message}`);
        continue;
      }
    }

    this.logger.warn(`All selectors failed for count extraction`);
    return 0;
  }

  private async extractText(page: Page, selectors: string[]): Promise<string | undefined> {
    for (const selector of selectors) {
      try {
        let element;
        
        if (selector.startsWith('//')) {
          const elements = await page.$x(selector);
          element = elements[0];
        } else {
          element = await page.$(selector);
        }

        if (element) {
          const text = await page.evaluate(el => el.textContent?.trim() || '', element);
          if (text) {
            this.logger.debug(`Extracted text "${text}" using selector: ${selector}`);
            return text;
          }
        }
      } catch (error) {
        this.logger.debug(`Selector failed: ${selector}, error: ${error.message}`);
        continue;
      }
    }

    return undefined;
  }

  private parseCount(text: string): number {
    if (!text) return 0;

    // 移除所有空白字符
    const cleanText = text.replace(/\s/g, '');

    // 处理中文数字单位
    if (cleanText.includes('万')) {
      const num = parseFloat(cleanText.replace('万', ''));
      return Math.floor(num * 10000);
    }

    if (cleanText.includes('千')) {
      const num = parseFloat(cleanText.replace('千', ''));
      return Math.floor(num * 1000);
    }

    if (cleanText.includes('k') || cleanText.includes('K')) {
      const num = parseFloat(cleanText.replace(/[kK]/g, ''));
      return Math.floor(num * 1000);
    }

    // 直接解析数字
    const num = parseInt(cleanText.replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? 0 : num;
  }

  async validateUrl(url: string): Promise<boolean> {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('xiaohongshu.com');
    } catch {
      return false;
    }
  }
}