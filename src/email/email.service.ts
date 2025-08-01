import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

interface NoteNotificationData {
  userEmail: string;
  projectName: string;
  action: 'created' | 'updated';
  noteUrl?: string;
  changes?: {
    likes: { old: number; new: number; diff: number };
    collects: { old: number; new: number; diff: number };
    comments: { old: number; new: number; diff: number };
    views: { old: number; new: number; diff: number };
    shares: { old: number; new: number; diff: number };
  };
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.error('RESEND_API_KEY is not configured');
      throw new Error('RESEND_API_KEY must be provided');
    }
    this.resend = new Resend(apiKey);
    this.logger.log('✅ Email service initialized');
  }

  async sendNoteNotification(data: NoteNotificationData): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      if (!this.resend) {
        return {
          success: false,
          error: 'Email service not configured',
        };
      }

      const isUpdate = data.action === 'updated' && data.changes;
      const actionText =
        data.action === 'created'
          ? 'Your App Featured on Xiaohongshu!'
          : 'Note Data Updated';
      const actionEmoji = data.action === 'created' ? '🎉' : '📊';

      let changesHtml = '';
      let changesText = '';

      if (isUpdate && data.changes) {
        const { likes, collects, comments, views, shares } = data.changes;
        const hasIncrease =
          likes.diff > 0 ||
          collects.diff > 0 ||
          comments.diff > 0 ||
          views.diff > 0 ||
          shares.diff > 0;

        // Calculate percentage increases
        const likesPercent =
          likes.old > 0 ? Math.round((likes.diff / likes.old) * 100) : 0;
        const viewsPercent =
          views.old > 0 ? Math.round((views.diff / views.old) * 100) : 0;
        const collectsPercent =
          collects.old > 0
            ? Math.round((collects.diff / collects.old) * 100)
            : 0;
        const commentsPercent =
          comments.old > 0
            ? Math.round((comments.diff / comments.old) * 100)
            : 0;
        const sharesPercent =
          shares.old > 0 ? Math.round((shares.diff / shares.old) * 100) : 0;

        changesHtml = `
          <div class="metrics-container">
            <h3 class="metrics-title">📊 Performance Update</h3>
            <div class="metrics-list">
              ${
                likes.diff !== 0
                  ? `
              <div class="metric-item">
                <div class="metric-left">
                  <div class="metric-icon">👍</div>
                  <div class="metric-label">Likes</div>
                </div>
                <div class="metric-right">
                  <div class="metric-values">
                    <span class="old-value">${likes.old.toLocaleString()}</span>
                    <span class="arrow">→</span>
                    <span class="new-value">${likes.new.toLocaleString()}</span>
                  </div>
                  <div class="metric-change ${likes.diff > 0 ? 'positive' : 'negative'}">
                    ${likes.diff > 0 ? '+' : ''}${likes.diff.toLocaleString()}
                    ${likes.old > 0 && likes.diff !== 0 ? ` (${likesPercent > 0 ? '+' : ''}${likesPercent}%)` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
              ${
                views.diff !== 0
                  ? `
              <div class="metric-item">
                <div class="metric-left">
                  <div class="metric-icon">👀</div>
                  <div class="metric-label">Views</div>
                </div>
                <div class="metric-right">
                  <div class="metric-values">
                    <span class="old-value">${views.old.toLocaleString()}</span>
                    <span class="arrow">→</span>
                    <span class="new-value">${views.new.toLocaleString()}</span>
                  </div>
                  <div class="metric-change ${views.diff > 0 ? 'positive' : 'negative'}">
                    ${views.diff > 0 ? '+' : ''}${views.diff.toLocaleString()}
                    ${views.old > 0 && views.diff !== 0 ? ` (${viewsPercent > 0 ? '+' : ''}${viewsPercent}%)` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
              ${
                collects.diff !== 0
                  ? `
              <div class="metric-item">
                <div class="metric-left">
                  <div class="metric-icon">⭐</div>
                  <div class="metric-label">Collects</div>
                </div>
                <div class="metric-right">
                  <div class="metric-values">
                    <span class="old-value">${collects.old.toLocaleString()}</span>
                    <span class="arrow">→</span>
                    <span class="new-value">${collects.new.toLocaleString()}</span>
                  </div>
                  <div class="metric-change ${collects.diff > 0 ? 'positive' : 'negative'}">
                    ${collects.diff > 0 ? '+' : ''}${collects.diff.toLocaleString()}
                    ${collects.old > 0 && collects.diff !== 0 ? ` (${collectsPercent > 0 ? '+' : ''}${collectsPercent}%)` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
              ${
                comments.diff !== 0
                  ? `
              <div class="metric-item">
                <div class="metric-left">
                  <div class="metric-icon">💬</div>
                  <div class="metric-label">Comments</div>
                </div>
                <div class="metric-right">
                  <div class="metric-values">
                    <span class="old-value">${comments.old.toLocaleString()}</span>
                    <span class="arrow">→</span>
                    <span class="new-value">${comments.new.toLocaleString()}</span>
                  </div>
                  <div class="metric-change ${comments.diff > 0 ? 'positive' : 'negative'}">
                    ${comments.diff > 0 ? '+' : ''}${comments.diff.toLocaleString()}
                    ${comments.old > 0 && comments.diff !== 0 ? ` (${commentsPercent > 0 ? '+' : ''}${commentsPercent}%)` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
              ${
                shares.diff !== 0
                  ? `
              <div class="metric-item">
                <div class="metric-left">
                  <div class="metric-icon">🔄</div>
                  <div class="metric-label">Shares</div>
                </div>
                <div class="metric-right">
                  <div class="metric-values">
                    <span class="old-value">${shares.old.toLocaleString()}</span>
                    <span class="arrow">→</span>
                    <span class="new-value">${shares.new.toLocaleString()}</span>
                  </div>
                  <div class="metric-change ${shares.diff > 0 ? 'positive' : 'negative'}">
                    ${shares.diff > 0 ? '+' : ''}${shares.diff.toLocaleString()}
                    ${shares.old > 0 && shares.diff !== 0 ? ` (${sharesPercent > 0 ? '+' : ''}${sharesPercent}%)` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
            </div>
            ${hasIncrease ? '<div class="success-banner">🎉 Amazing growth! Your app is gaining momentum on Xiaohongshu!</div>' : ''}
          </div>
        `;

        changesText = `
Performance Update:
${likes.diff !== 0 ? `• Likes: ${likes.old.toLocaleString()} → ${likes.new.toLocaleString()} (${likes.diff > 0 ? '+' : ''}${likes.diff.toLocaleString()}${likes.old > 0 && likes.diff !== 0 ? `, ${likesPercent > 0 ? '+' : ''}${likesPercent}%` : ''})` : ''}
${views.diff !== 0 ? `• Views: ${views.old.toLocaleString()} → ${views.new.toLocaleString()} (${views.diff > 0 ? '+' : ''}${views.diff.toLocaleString()}${views.old > 0 && views.diff !== 0 ? `, ${viewsPercent > 0 ? '+' : ''}${viewsPercent}%` : ''})` : ''}
${collects.diff !== 0 ? `• Collects: ${collects.old.toLocaleString()} → ${collects.new.toLocaleString()} (${collects.diff > 0 ? '+' : ''}${collects.diff.toLocaleString()}${collects.old > 0 && collects.diff !== 0 ? `, ${collectsPercent > 0 ? '+' : ''}${collectsPercent}%` : ''})` : ''}
${comments.diff !== 0 ? `• Comments: ${comments.old.toLocaleString()} → ${comments.new.toLocaleString()} (${comments.diff > 0 ? '+' : ''}${comments.diff.toLocaleString()}${comments.old > 0 && comments.diff !== 0 ? `, ${commentsPercent > 0 ? '+' : ''}${commentsPercent}%` : ''})` : ''}
${shares.diff !== 0 ? `• Shares: ${shares.old.toLocaleString()} → ${shares.new.toLocaleString()} (${shares.diff > 0 ? '+' : ''}${shares.diff.toLocaleString()}${shares.old > 0 && shares.diff !== 0 ? `, ${sharesPercent > 0 ? '+' : ''}${sharesPercent}%` : ''})` : ''}
${hasIncrease ? '🎉 Amazing growth! Your app is gaining momentum on Xiaohongshu!' : ''}
        `;
      }

      // Full HTML template with styles
      const emailHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${actionText} - ${data.projectName}</title>
            <style>
              body {
                font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                line-height: 1.6;
                color: #37352f;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #ffffff;
              }
              .header {
                background: #ffffff;
                color: #37352f;
                padding: 32px 24px;
                border-radius: 8px 8px 0 0;
                text-align: center;
                border: 1px solid #e5e5e5;
                border-bottom: none;
              }
              .content {
                background: #ffffff;
                padding: 32px 24px;
                border: 1px solid #e5e5e5;
                border-top: none;
                border-bottom: none;
              }
              .metrics-container {
                background: #f8f8f8;
                padding: 20px;
                border-radius: 6px;
                margin: 24px 0;
                border: 1px solid #e5e5e5;
              }
              .metrics-title {
                font-size: 16px;
                font-weight: 600;
                color: #37352f;
                margin: 0 0 16px 0;
                display: flex;
                align-items: center;
                gap: 6px;
              }
              .metrics-list {
                display: flex;
                flex-direction: column;
                gap: 0;
              }
              .metric-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 0;
                border-bottom: 1px solid #e5e5e5;
              }
              .metric-item:last-child {
                border-bottom: none;
              }
              .metric-left {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
              }
              .metric-icon {
                font-size: 16px;
                width: 20px;
                text-align: center;
              }
              .metric-label {
                font-size: 14px;
                font-weight: 500;
                color: #37352f;
              }
              .metric-right {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 14px;
              }
              .metric-values {
                color: #6b7280;
                font-weight: 400;
              }
              .old-value {
                color: #9ca3af;
              }
              .arrow {
                color: #9ca3af;
                margin: 0 2px;
              }
              .new-value {
                color: #37352f;
                font-weight: 500;
              }
              .metric-change {
                font-size: 13px;
                font-weight: 500;
                padding: 2px 6px;
                border-radius: 4px;
                min-width: 60px;
                text-align: center;
              }
              .metric-change.positive {
                background: #f0f9f4;
                color: #22c55e;
              }
              .metric-change.negative {
                background: #fef2f2;
                color: #ef4444;
              }
              .success-banner {
                background: #22c55e;
                color: white;
                padding: 12px 16px;
                border-radius: 6px;
                font-weight: 500;
                text-align: center;
                margin-top: 16px;
                font-size: 14px;
              }
              .cta-button {
                display: inline-block;
                background: #37352f;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 6px;
                margin: 16px 16px 16px 0;
                font-weight: 500;
                font-size: 14px;
                border: 1px solid #37352f;
              }
              .cta-button:hover {
                background: #000000;
                border-color: #000000;
              }
              .footer {
                text-align: center;
                padding: 24px;
                color: #9ca3af;
                font-size: 13px;
                border-radius: 0 0 8px 8px;
                background: #f8f8f8;
                border: 1px solid #e5e5e5;
                border-top: none;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin: 0; font-size: 22px; font-weight: 600;">${actionEmoji} ${actionText}</h1>
              <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px;">${data.projectName}</p>
            </div>
            
            <div class="content">
              <p>Hey there! 👋</p>
              <p>${
                data.action === 'created'
                  ? `Amazing news! <strong>${data.projectName}</strong> just got featured on Xiaohongshu! 🎉 This is huge - your app is now in front of millions of active users in China who love discovering cool new products.`
                  : `We've got some fresh numbers for <strong>${data.projectName}</strong> on Xiaohongshu! Here's how your post is performing:`
              }</p>
              
              ${changesHtml}
              
              ${
                data.noteUrl
                  ? `
              <div style="margin: 30px 0;">
                <a href="${data.noteUrl}" class="cta-button" target="_blank">
                  View on Xiaohongshu
                </a>
              </div>
              `
                  : ''
              }
              
              ${
                data.action === 'created'
                  ? `
              <p style="margin-top: 24px; padding: 16px; background-color: #f8f9fa; border-left: 3px solid #000; border-radius: 6px; color: #37352f;">
                <strong>💡 Quick tip:</strong> This is perfect content to share with your community and investors. Xiaohongshu exposure can be a real game-changer for market entry in China!
              </p>
              `
                  : `
              <p style="margin-top: 24px; color: #6b7280;">
                Keep up the great work! 🚀 These numbers show real people are discovering and engaging with your product.
              </p>
              `
              }
            </div>
            
            <div class="footer">
              <p>Best regards,<br>Redverse Team</p>
              <p style="font-size: 12px; color: #999;">
                This notification was sent by the Redverse Xiaohongshu Crawler.
              </p>
            </div>
          </body>
        </html>
      `;

      const emailText = `
${actionText} - ${data.projectName}

Hey there! 👋

${
  data.action === 'created'
    ? `Amazing news! ${data.projectName} just got featured on Xiaohongshu! 🎉 This is huge - your app is now in front of millions of active users in China who love discovering cool new products.`
    : `We've got some fresh numbers for ${data.projectName} on Xiaohongshu! Here's how your post is performing:`
}

${changesText}

${data.noteUrl ? `View on Xiaohongshu: ${data.noteUrl}` : ''}

${
  data.action === 'created'
    ? `
💡 Quick tip: This is perfect content to share with your community and investors. Xiaohongshu exposure can be a real game-changer for market entry in China!`
    : `
Keep up the great work! 🚀 These numbers show real people are discovering and engaging with your product.`
}

Best regards,
Redverse Team
      `;

      await this.resend.emails.send({
        from: 'Redverse <hello@redverse.online>',
        to: data.userEmail,
        subject: `${actionEmoji} ${actionText} - ${data.projectName}`,
        html: emailHtml,
        text: emailText,
      });

      this.logger.log(
        `📧 Note notification email sent successfully to ${data.userEmail} for ${data.projectName}`,
      );

      return {
        success: true,
      };
    } catch (error) {
      this.logger.error('Failed to send note notification email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
