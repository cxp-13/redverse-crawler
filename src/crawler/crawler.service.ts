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

  // 新方法：通过应用名称搜索笔记数据（支持递归搜索）
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

      // 使用递归搜索策略
      const result = await this.recursiveSearch(page, appName);

      if (!result.success) {
        return result;
      }

      this.logger.log(
        `✅ 成功获取应用 "${appName}" 的笔记数据 (使用搜索词: "${result.usedSearchTerm}")`,
      );

      return {
        success: true,
        data: result.data,
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

  // 递归搜索策略：从完整应用名开始，逐步减少字符直到找到结果
  private async recursiveSearch(
    page: Page,
    originalAppName: string,
  ): Promise<{
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
    usedSearchTerm?: string;
  }> {
    const appName = originalAppName.trim();

    // 动态计算最小搜索长度：中文字符最少1个，英文字符最少2个
    const minSearchLength = this.containsChinese(appName) ? 1 : 2;

    this.logger.log(
      `🎯 开始递归搜索应用 "${originalAppName}"，最小搜索长度: ${minSearchLength}`,
    );

    const searchAttempts: string[] = [];

    for (let length = appName.length; length >= minSearchLength; length--) {
      const searchTerm = appName.substring(0, length);
      searchAttempts.push(searchTerm);

      this.logger.log(
        `🔍 尝试搜索词: "${searchTerm}" (长度: ${length}/${appName.length})`,
      );

      try {
        const noteData = await this.searchAndCaptureNoteData(page, searchTerm);

        if (noteData) {
          this.logger.log(
            `✅ 搜索成功！使用搜索词: "${searchTerm}"，找到笔记数据`,
          );
          this.logger.log(
            `📊 数据预览: 赞=${noteData.likes}, 收藏=${noteData.collected_count}, 浏览=${noteData.view_count}`,
          );

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
            usedSearchTerm: searchTerm,
          };
        } else {
          this.logger.warn(
            `⚠️ 搜索词 "${searchTerm}" 无结果，继续尝试更短的搜索词...`,
          );
        }
      } catch (error) {
        this.logger.error(`搜索词 "${searchTerm}" 时发生错误:`, error);
        // 继续尝试下一个更短的搜索词
        continue;
      }

      // 为了避免频繁请求，在每次尝试之间稍作延迟
      await page.waitForTimeout(1500);
    }

    this.logger.error(
      `❌ 递归搜索失败，已尝试的搜索词: [${searchAttempts.join(', ')}]`,
    );

    return {
      success: false,
      error: `应用 "${originalAppName}" 的所有搜索尝试都失败了（尝试了 ${searchAttempts.length} 个搜索词: ${searchAttempts.join(', ')}）`,
    };
  }

  // 检查字符串是否包含中文字符
  private containsChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      page.on('response', responseHandler as any);

      // 清空搜索框
      await this.clearSearchInput(page);

      // 输入应用名称
      await this.inputSearchKeyword(page, appName);

      // 等待API响应
      await page.waitForTimeout(3000);

      // 移除事件监听器
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      page.off('response', responseHandler as any);

      if (capturedData) {
        this.logger.debug(`🎯 搜索词 "${appName}" 成功捕获数据`);
      } else {
        this.logger.debug(`❌ 搜索词 "${appName}" 未捕获到任何数据`);
      }

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
