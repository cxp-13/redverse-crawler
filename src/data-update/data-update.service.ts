import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CrawlerService } from '../crawler/crawler.service';
import { SupabaseService } from '../lib/supabase';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { ClerkService } from '../clerk/clerk.service';

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

  constructor(
    private authService: AuthService,
    private crawlerService: CrawlerService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
    private emailService: EmailService,
    private clerkService: ClerkService,
  ) {
    // 设置登录成功后的回调
    this.authService.setLoginSuccessCallback(() => {
      this.startBatchUpdate();
    });
  }

  // 开始批量更新
  async startBatchUpdate(): Promise<void> {
    if (this.isUpdating) {
      this.logger.warn('Batch update already in progress');
      return;
    }

    this.isUpdating = true;
    this.logger.log('🚀 Starting batch update process...');

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

      // 获取所有应用和对应的笔记
      const appsWithNotes = await this.fetchAllApplicationsWithNotes();
      if (!appsWithNotes || appsWithNotes.length === 0) {
        this.logger.warn('No applications with notes found to update');
        await this.authService.updateSystemStatus({
          updateStatus: 'completed',
          lastUpdate: new Date(),
        });
        // 清理Redis进度数据
        await this.redisService.deleteProgress();
        return;
      }

      // 计算总笔记数
      const totalNotes = appsWithNotes.reduce((sum, item) => sum + item.notes.length, 0);

      // 更新总数
      await this.authService.updateSystemStatus({
        progress: {
          total: totalNotes,
          processed: 0,
          failed: 0,
        },
      });

      this.logger.log(`📊 Found ${appsWithNotes.length} applications with ${totalNotes} total notes to update`);

      // 逐个应用处理
      let processed = 0;
      let failed = 0;

      for (const appWithNotes of appsWithNotes) {
        const { application, notes } = appWithNotes;
        
        this.logger.log(`🔄 Processing application: "${application.name}" with ${notes.length} notes`);

        try {
          // 通过应用名称搜索获取最新数据
          const result = await this.crawlerService.crawlNoteDataByAppName(application.name);
          
          if (result.success && result.data) {
            // 更新所有关联的笔记
            for (const note of notes) {
              try {
                await this.updateNoteWithEmailNotification(note, result.data);
                processed++;
                this.logger.log(`✅ Successfully updated note: ${note.id} for app "${application.name}"`);
              } catch (error) {
                failed++;
                this.logger.error(`❌ Error updating note ${note.id}:`, error);
              }

              // 更新进度
              await this.authService.updateSystemStatus({
                progress: {
                  total: totalNotes,
                  processed: processed,
                  failed: failed,
                },
              });
            }
          } else {
            // 如果搜索失败，所有相关笔记都标记为失败
            failed += notes.length;
            processed += notes.length; // 仍然计入已处理，避免卡住
            this.logger.error(`❌ Failed to get data for app "${application.name}": ${result.error}`);
            
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
          failed += notes.length;
          processed += notes.length;
          this.logger.error(`❌ Error processing app "${application.name}":`, error);
          
          // 更新进度
          await this.authService.updateSystemStatus({
            progress: {
              total: totalNotes,
              processed: processed,
              failed: failed,
            },
          });
        }

        // 添加进度更新调试日志
        this.logger.log(`📊 Progress: ${processed}/${totalNotes} (failed: ${failed}) at ${new Date().toLocaleTimeString()}`);

        // 避免请求过快，添加延迟
        await this.delay(3000);
      }

      // 更新完成
      this.logger.log(`🎉 Batch update completed! Processed: ${processed}, Failed: ${failed}`);
      await this.authService.updateSystemStatus({
        updateStatus: 'completed',
        lastUpdate: new Date(),
      });
      
      // 清理Redis进度数据
      await this.redisService.deleteProgress();
      this.logger.log('🗑️ Progress data cleaned from Redis');

    } catch (error) {
      this.logger.error('❌ Batch update failed:', error);
      await this.authService.updateSystemStatus({
        updateStatus: 'failed',
        error: error.message,
      });
    } finally {
      this.isUpdating = false;
    }
  }

  // 获取所有应用和对应的笔记数据
  private async fetchAllApplicationsWithNotes(): Promise<Array<{application: Application, notes: Note[]}> | null> {
    try {
      const supabase = this.supabaseService.getClient();
      
      // 获取所有应用
      const { data: applications, error: appError } = await supabase
        .from('application')
        .select('id, name, user_id');

      if (appError) {
        this.logger.error('Failed to fetch applications from Supabase:', appError);
        return null;
      }

      if (!applications || applications.length === 0) {
        this.logger.warn('No applications found');
        return [];
      }

      // 为每个应用获取对应的笔记
      const result: Array<{application: Application, notes: Note[]}> = [];
      for (const app of applications) {
        const { data: notes, error: noteError } = await supabase
          .from('note')
          .select('id, url, app_id, likes_count, collects_count, comments_count, views_count, shares_count')
          .eq('app_id', app.id);

        if (noteError) {
          this.logger.error(`Failed to fetch notes for app ${app.id}:`, noteError);
          continue;
        }

        if (notes && notes.length > 0) {
          result.push({
            application: app as Application,
            notes: notes as Note[]
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error fetching applications with notes:', error);
      return null;
    }
  }

  // 更新单个note到Supabase
  private async updateNoteInSupabase(noteId: string, data: any): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      const updateData = {
        likes_count: data.likes_count,
        collects_count: data.collects_count,
        comments_count: data.comments_count,
        views_count: data.views_count,
        shares_count: data.shares_count,
      };

      const { error } = await supabase
        .from('note')
        .update(updateData)
        .eq('id', noteId);

      if (error) {
        throw error;
      }
    } catch (error) {
      this.logger.error(`Failed to update note ${noteId} in Supabase:`, error);
      throw error;
    }
  }

  // 获取应用信息
  private async getApplicationByAppId(appId: string): Promise<Application | null> {
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from('application')
        .select('id, name, user_id')
        .eq('id', appId)
        .single();

      if (error) {
        this.logger.error(`Failed to fetch application ${appId}:`, error);
        return null;
      }

      return data as Application;
    } catch (error) {
      this.logger.error(`Error fetching application ${appId}:`, error);
      return null;
    }
  }

  // 更新笔记并发送邮件通知
  private async updateNoteWithEmailNotification(note: Note, newData: any): Promise<void> {
    try {
      // 1. 更新数据到Supabase
      await this.updateNoteInSupabase(note.id, newData);
      
      // 2. 如果没有app_id，跳过邮件发送
      if (!note.app_id) {
        this.logger.debug(`Note ${note.id} has no app_id, skipping email notification`);
        return;
      }

      // 3. 检查是否有数据变化
      const hasChanges = (
        newData.likes_count !== (note.likes_count || 0) ||
        newData.collects_count !== (note.collects_count || 0) ||
        newData.comments_count !== (note.comments_count || 0) ||
        newData.views_count !== (note.views_count || 0) ||
        newData.shares_count !== (note.shares_count || 0)
      );

      if (!hasChanges) {
        this.logger.debug(`No changes detected for note ${note.id}, skipping email notification`);
        return;
      }

      // 4. 获取应用信息
      const application = await this.getApplicationByAppId(note.app_id);
      if (!application) {
        this.logger.warn(`Application not found for app_id ${note.app_id}, skipping email notification`);
        return;
      }

      // 5. 获取用户邮箱
      const userEmail = await this.clerkService.getUserEmailByUserId(application.user_id);
      if (!userEmail) {
        this.logger.warn(`User email not found for user_id ${application.user_id}, skipping email notification`);
        return;
      }

      // 6. 计算变化
      const changes = {
        likes: { 
          old: note.likes_count || 0, 
          new: newData.likes_count || 0, 
          diff: (newData.likes_count || 0) - (note.likes_count || 0)
        },
        collects: { 
          old: note.collects_count || 0, 
          new: newData.collects_count || 0, 
          diff: (newData.collects_count || 0) - (note.collects_count || 0)
        },
        comments: { 
          old: note.comments_count || 0, 
          new: newData.comments_count || 0, 
          diff: (newData.comments_count || 0) - (note.comments_count || 0)
        },
        views: { 
          old: note.views_count || 0, 
          new: newData.views_count || 0, 
          diff: (newData.views_count || 0) - (note.views_count || 0)
        },
        shares: { 
          old: note.shares_count || 0, 
          new: newData.shares_count || 0, 
          diff: (newData.shares_count || 0) - (note.shares_count || 0)
        },
      };

      // 7. 发送邮件通知
      try {
        await this.emailService.sendNoteNotification({
          userEmail,
          projectName: application.name,
          action: 'updated',
          noteUrl: note.url,
          changes,
        });
        this.logger.log(`📧 Email notification sent to ${userEmail} for ${application.name}`);
      } catch (emailError) {
        this.logger.error(`Failed to send email notification:`, emailError);
        // 邮件发送失败不应该中断更新流程
      }
    } catch (error) {
      this.logger.error(`Error in updateNoteWithEmailNotification:`, error);
      throw error;
    }
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}