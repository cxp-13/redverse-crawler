import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page, ElementHandle } from 'puppeteer';
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
  };
  error?: string;
}

interface CreatorNoteData {
  collected_count: number;
  view_count: number;
  likes: number;
  comments_count: number;
  shared_count: number;
  display_title: string;
  id: string;
}

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly SEARCH_INPUT_XPATH =
    '//*[@id="content-area"]/main/div[3]/div/div/div[1]/div/div/input';
  private readonly API_URL_PATTERN =
    'https://edith.xiaohongshu.com/web_api/sns/v5/creator/note/managemaent/search';

  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  // 新方法：通过应用名称搜索笔记数据
  async crawlNoteDataByAppName(appName: string): Promise<CrawlResult> {
    const page = await this.authService.getAuthenticatedPage();

    if (!page) {
      return {
        success: false,
        error: '未登录，无法获取数据',
      };
    }

    try {
      this.logger.log(`开始搜索应用 "${appName}" 的笔记数据`);

      // 确保页面在笔记管理页面
      const currentUrl = page.url();
      if (!currentUrl.includes('note-manager')) {
        await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await page.waitForTimeout(2000);
      }

      // 搜索应用名称并监听API响应
      const noteData = await this.searchAndCaptureNoteData(page, appName);

      if (!noteData) {
        return {
          success: false,
          error: `未找到应用 "${appName}" 对应的笔记数据`,
        };
      }

      this.logger.log(`✅ 成功获取应用 "${appName}" 的笔记数据`);

      return {
        success: true,
        data: {
          likes_count: noteData.likes || 0,
          collects_count: noteData.collected_count || 0,
          comments_count: noteData.comments_count || 0,
          views_count: noteData.view_count || 0,
          shares_count: noteData.shared_count || 0,
          title: noteData.display_title,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to search note for app ${appName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // 保留原有方法以保持兼容性
  crawlNoteData(): Promise<CrawlResult> {
    return Promise.resolve({
      success: false,
      error: '此方法已弃用，请使用 crawlNoteDataByAppName',
    });
  }

  // 搜索应用名称并捕获API响应数据
  private async searchAndCaptureNoteData(
    page: Page,
    appName: string,
  ): Promise<CreatorNoteData | null> {
    try {
      // 设置请求拦截器
      let capturedData: CreatorNoteData | null = null;

      const responseHandler = async (response: {
        url: () => string;
        json: () => Promise<unknown>;
        status: () => number;
        headers: () => Record<string, string>;
      }): Promise<void> => {
        const url = response.url();
        if (
          url.includes(this.API_URL_PATTERN) &&
          url.includes(`keyword=${encodeURIComponent(appName)}`)
        ) {
          try {
            const responseData = (await response.json()) as {
              success: boolean;
              data?: {
                notes?: CreatorNoteData[];
              };
            };

            if (
              responseData.success &&
              responseData.data &&
              responseData.data.notes &&
              responseData.data.notes.length > 0
            ) {
              const notes = responseData.data.notes;
              this.logger.log(
                `✅ API响应解析成功，找到 ${notes.length} 条笔记数据`,
              );

              // 汇总所有笔记的数据
              capturedData = {
                collected_count: 0,
                view_count: 0,
                likes: 0,
                comments_count: 0,
                shared_count: 0,
                display_title: notes[0].display_title,
                id: notes.map((note: CreatorNoteData) => note.id).join(','),
              };

              // 累加各项数据
              for (const note of notes) {
                capturedData.collected_count += note.collected_count || 0;
                capturedData.view_count += note.view_count || 0;
                capturedData.likes += note.likes || 0;
                capturedData.comments_count += note.comments_count || 0;
                capturedData.shared_count += note.shared_count || 0;
              }

              this.logger.log(
                `📊 数据汇总完成: 赞=${capturedData.likes}, 收藏=${capturedData.collected_count}, 浏览=${capturedData.view_count}, 评论=${capturedData.comments_count}, 分享=${capturedData.shared_count}`,
              );
            } else {
              this.logger.warn(
                `API响应格式异常或无数据: success=${responseData.success}, hasData=${!!responseData.data}, hasNotes=${!!responseData.data?.notes}`,
              );
            }
          } catch (error) {
            this.logger.error(
              `API响应解析失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
            this.logger.debug(
              `响应状态: ${response.status()}, Content-Type: ${response.headers()['content-type']}`,
            );
          }
        }
      };

      page.on('response', responseHandler as any);

      // 清空搜索框
      await this.clearSearchInput(page);

      // 输入应用名称
      await this.inputSearchKeyword(page, appName);

      // 等待API响应
      await page.waitForTimeout(3000);

      // 移除事件监听器
      page.off('response', responseHandler as any);

      return capturedData;
    } catch (error) {
      this.logger.error(
        `Error in searchAndCaptureNoteData:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  // 清空搜索输入框
  private async clearSearchInput(page: Page): Promise<void> {
    try {
      const searchInput = await page.$x(this.SEARCH_INPUT_XPATH);
      if (searchInput.length > 0) {
        await (searchInput[0] as ElementHandle).click();
        await page.waitForTimeout(500);

        // 全选并删除
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
      }
    } catch (error) {
      this.logger.warn('Failed to clear search input:', error);
    }
  }

  // 输入搜索关键词
  private async inputSearchKeyword(page: Page, keyword: string): Promise<void> {
    try {
      const searchInput = await page.$x(this.SEARCH_INPUT_XPATH);
      if (searchInput.length === 0) {
        throw new Error('Search input field not found');
      }

      await (searchInput[0] as ElementHandle).type(keyword, { delay: 100 });
      await page.keyboard.press('Enter');

      this.logger.debug(`搜索关键词 "${keyword}" 已输入并提交`);
    } catch (error) {
      this.logger.error(
        `Failed to input search keyword:`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  // 验证应用名称是否有效（简单的非空检查）
  validateAppName(appName: string): boolean {
    return typeof appName === 'string' && appName.trim().length > 0;
  }
}
