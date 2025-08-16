import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CrawlerService } from '../crawler/crawler.service';
import { SupabaseService } from '../lib/supabase';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { RetryUtil } from '../common/utils/retry.util';

interface Note {
  id: string;
  url: string;
  app_id?: string;
  likes_count?: number;
  collects_count?: number;
  comments_count?: number;
  views_count?: number;
  shares_count?: number;
}

interface Application {
  id: string;
  name: string;
  user_id: string;
}

@Injectable()
export class DataUpdateService {
  private readonly logger = new Logger(DataUpdateService.name);
  private isUpdating = false;
  private readonly maxConcurrentRequests = 3;
  private readonly retryOptions = {
    maxRetries: 10,
    baseDelay: 1000,
    maxDelay: 10000,
    exponentialBackoff: true,
  };

  constructor(
    private authService: AuthService,
    private crawlerService: CrawlerService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
    private emailService: EmailService,
  ) {
    // 设置登录成功后的回调
    this.authService.setLoginSuccessCallback(() => {
      void this.startBatchUpdate();
    });
  }

  async startBatchUpdate(): Promise<void> {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;
    this.logger.log('Batch update started');

    try {
      // 更新状态为"更新中"
      await this.authService.updateSystemStatus({
        updateStatus: 'updating',
        progress: {
          total: 0,
          processed: 0,
          failed: 0,
        },
      });

      const appsWithNotes = await this.fetchAllApplicationsWithNotes();
      if (!appsWithNotes || appsWithNotes.length === 0) {
        await this.authService.updateSystemStatus({
          updateStatus: 'completed',
          lastUpdate: new Date(),
        });
        await this.redisService.deleteProgress();
        return;
      }

      // 计算总笔记数
      const totalNotes = appsWithNotes.reduce(
        (sum, item) => sum + item.notes.length,
        0,
      );

      // 更新总数
      await this.authService.updateSystemStatus({
        progress: {
          total: totalNotes,
          processed: 0,
          failed: 0,
        },
      });

      this.logger.log(
        `[Data Update] Processing ${totalNotes} notes from ${appsWithNotes.length} apps`,
      );

      // 逐个应用处理
      let processed = 0;
      let failed = 0;

      for (const appWithNotes of appsWithNotes) {
        const { application, notes } = appWithNotes;

        try {
          // 通过应用名称搜索获取最新数据
          const result = await this.crawlerService.crawlNoteDataByAppName(
            application.name,
          );

          if (result.success && result.data) {
            // 分批处理笔记更新，控制并发数量
            const crawledData = result.data; // Save reference to avoid undefined type issue
            await this.processBatchWithConcurrency(
              notes,
              async (note) => {
                await this.updateNoteWithEmailNotification(note, crawledData);
              },
              this.maxConcurrentRequests,
              async (note, success) => {
                if (success) {
                  processed++;
                } else {
                  failed++;
                  this.logger.error(`Failed to update note ${note.id}`);
                }

                // 更新进度
                await this.authService.updateSystemStatus({
                  progress: {
                    total: totalNotes,
                    processed: processed,
                    failed: failed,
                  },
                });
              },
            );
          } else {
            // 如果搜索失败，所有相关笔记都标记为失败
            failed += notes.length;
            processed += notes.length; // 仍然计入已处理，避免卡住
            this.logger.error(
              `Failed to get data for app "${application.name}": ${result.error}`,
            );

            // 更新进度
            await this.authService.updateSystemStatus({
              progress: {
                total: totalNotes,
                processed: processed,
                failed: failed,
              },
            });
          }
        } catch (error) {
          // Check if this is a network/critical error that should stop the process
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const isNetworkError =
            errorMessage.includes('Application not found') ||
            errorMessage.includes('fetch failed') ||
            errorMessage.includes('Network error');

          if (isNetworkError) {
            this.logger.error(
              `Critical error processing app "${application.name}", stopping process:`,
              error,
            );
            // Re-throw to stop the entire process
            throw error;
          }

          // For non-critical errors, continue with next app
          failed += notes.length;
          processed += notes.length;
          this.logger.error(
            `Error processing app "${application.name}":`,
            error,
          );

          // 更新进度
          await this.authService.updateSystemStatus({
            progress: {
              total: totalNotes,
              processed: processed,
              failed: failed,
            },
          });
        }

        // 避免请求过快，添加延迟
        await this.delay(3000);
      }

      this.logger.log(
        `[Data Update] Batch update completed: ${processed} processed, ${failed} failed`,
      );
      await this.authService.updateSystemStatus({
        updateStatus: 'completed',
        lastUpdate: new Date(),
      });

      await this.redisService.deleteProgress();
    } catch (error) {
      this.logger.error('Batch update failed:', error);
      await this.authService.updateSystemStatus({
        updateStatus: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isUpdating = false;
    }
  }

  // 获取所有应用和对应的笔记数据
  private async fetchAllApplicationsWithNotes(): Promise<Array<{
    application: Application;
    notes: Note[];
  }> | null> {
    try {
      return await RetryUtil.withRetry(async () => {
        const supabase = this.supabaseService.getClient();

        // 获取所有应用
        const { data: applications, error: appError } = await supabase
          .from('applications')
          .select('id, name, user_id');

        if (appError) {
          this.logger.error(
            'Failed to fetch applications from Supabase:',
            appError,
          );
          throw new Error(
            `Supabase error: ${appError.message || JSON.stringify(appError)}`,
          );
        }

        if (!applications || applications.length === 0) {
          return [];
        }

        // 为每个应用获取对应的笔记
        const result: Array<{ application: Application; notes: Note[] }> = [];
        for (const app of applications) {
          const { data: notes, error: noteError } = await supabase
            .from('notes')
            .select(
              'id, url, app_id, likes_count, collects_count, comments_count, views_count, shares_count',
            )
            .eq('app_id', app.id);

          if (noteError) {
            this.logger.error(
              `Failed to fetch notes for app ${app.id}:`,
              noteError,
            );
            continue;
          }

          if (notes && notes.length > 0) {
            result.push({
              application: app as Application,
              notes: notes as Note[],
            });
          }
        }

        return result;
      }, this.retryOptions);
    } catch (error) {
      this.logger.error(
        'Error fetching applications with notes after retries:',
        error,
      );
      return null;
    }
  }

  // 更新单个note到Supabase
  private async updateNoteInSupabase(
    noteId: string,
    data: {
      likes_count: number;
      collects_count: number;
      comments_count: number;
      views_count: number;
      shares_count: number;
    },
  ): Promise<void> {
    try {
      await RetryUtil.withRetry(async () => {
        const supabase = this.supabaseService.getClient();
        const updateData = {
          likes_count: data.likes_count,
          collects_count: data.collects_count,
          comments_count: data.comments_count,
          views_count: data.views_count,
          shares_count: data.shares_count,
        };

        const { error } = await supabase
          .from('notes')
          .update(updateData)
          .eq('id', noteId);

        if (error) {
          throw new Error(
            `Supabase error: ${error.message || JSON.stringify(error)}`,
          );
        }
      }, this.retryOptions);
    } catch (error) {
      this.logger.error(
        `Failed to update note ${noteId} after retries:`,
        error,
      );
      throw error;
    }
  }

  // 获取应用信息
  private async getApplicationByAppId(
    appId: string,
  ): Promise<Application | null> {
    try {
      return await RetryUtil.withRetry(async () => {
        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase
          .from('applications')
          .select('id, name, user_id')
          .eq('id', appId)
          .single();

        if (error) {
          throw new Error(
            `Supabase error: ${error.message || JSON.stringify(error)}`,
          );
        }

        return data as Application;
      }, this.retryOptions);
    } catch (error) {
      this.logger.error(
        `Failed to fetch application ${appId} after retries:`,
        error,
      );
      return null;
    }
  }

  // 更新笔记并发送邮件通知
  private async updateNoteWithEmailNotification(
    note: Note,
    newData: {
      likes_count: number;
      collects_count: number;
      comments_count: number;
      views_count: number;
      shares_count: number;
    },
  ): Promise<void> {
    try {
      // 1. 更新数据到Supabase
      await this.updateNoteInSupabase(note.id, newData);

      if (!note.app_id) {
        return;
      }

      // 3. 计算数据变化（用于记录，但不影响邮件发送）
      const hasChanges =
        newData.likes_count !== (note.likes_count || 0) ||
        newData.collects_count !== (note.collects_count || 0) ||
        newData.comments_count !== (note.comments_count || 0) ||
        newData.views_count !== (note.views_count || 0) ||
        newData.shares_count !== (note.shares_count || 0);

      // 4. 获取应用信息
      const application = await this.getApplicationByAppId(note.app_id);
      if (!application) {
        this.logger.error(`Application not found for app_id ${note.app_id}`);
        throw new Error(`Application not found for app_id ${note.app_id}`);
      }

      // No need to get user email here anymore - redverse API will handle it

      // 6. 计算变化
      const changes = {
        likes: {
          old: note.likes_count || 0,
          new: newData.likes_count,
          diff: newData.likes_count - (note.likes_count || 0),
        },
        collects: {
          old: note.collects_count || 0,
          new: newData.collects_count,
          diff: newData.collects_count - (note.collects_count || 0),
        },
        comments: {
          old: note.comments_count || 0,
          new: newData.comments_count,
          diff: newData.comments_count - (note.comments_count || 0),
        },
        views: {
          old: note.views_count || 0,
          new: newData.views_count,
          diff: newData.views_count - (note.views_count || 0),
        },
        shares: {
          old: note.shares_count || 0,
          new: newData.shares_count,
          diff: newData.shares_count - (note.shares_count || 0),
        },
      };

      // 7. 发送完整数据邮件通知（无论是否有变化）
      const emailAction = hasChanges ? 'updated' : 'report';

      try {
        await this.emailService.sendNoteNotification({
          userId: application.user_id,
          projectName: application.name,
          action: emailAction,
          noteUrl: note.url,
          changes,
          completeData: {
            likes_count: newData.likes_count,
            collects_count: newData.collects_count,
            comments_count: newData.comments_count,
            views_count: newData.views_count,
            shares_count: newData.shares_count,
          },
          dataDate: new Date().toISOString(),
        });
      } catch (emailError) {
        const errorMessage =
          emailError instanceof Error ? emailError.message : String(emailError);
        this.logger.error(
          `[Data Update] Email sending failed - project: "${application.name}", userID: ${application.user_id}`,
          {
            message: errorMessage,
            noteId: note.id,
            noteUrl: note.url,
            userId: application.user_id,
            appName: application?.name,
          },
        );
        // 邮件发送失败不应该中断更新流程
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error in updateNoteWithEmailNotification for note ${note.id}:`,
        {
          message: errorMessage,
          details: error instanceof Error ? error.stack : String(error),
          noteId: note.id,
          noteUrl: note.url,
          appId: note.app_id,
        },
      );
      throw error;
    }
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 并发控制批量处理
  private async processBatchWithConcurrency<T>(
    items: T[],
    processor: (item: T) => Promise<void>,
    maxConcurrency: number,
    onComplete?: (item: T, success: boolean) => Promise<void>,
  ): Promise<void> {
    // Simple chunked approach for better stability
    for (let i = 0; i < items.length; i += maxConcurrency) {
      const chunk = items.slice(i, i + maxConcurrency);
      const promises = chunk.map(async (item) => {
        try {
          await processor(item);
          if (onComplete) {
            await onComplete(item, true);
          }
        } catch (error) {
          this.logger.error(`Error processing item:`, error);
          if (onComplete) {
            await onComplete(item, false);
          }
          // Re-throw network-related errors to stop the entire process
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('Application not found') ||
            errorMessage.includes('fetch failed') ||
            errorMessage.includes('Network error')
          ) {
            throw error;
          }
        }
      });

      await Promise.all(promises);

      // Small delay between batches to avoid overwhelming the server
      if (i + maxConcurrency < items.length) {
        await this.delay(500); // 500ms delay between batches
      }
    }
  }
}
