import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface NoteNotificationData {
  userId: string;
  projectName: string;
  action: 'created' | 'updated' | 'report';
  noteUrl?: string;
  changes?: {
    likes: { old: number; new: number; diff: number };
    collects: { old: number; new: number; diff: number };
    comments: { old: number; new: number; diff: number };
    views: { old: number; new: number; diff: number };
    shares: { old: number; new: number; diff: number };
  };
  completeData?: {
    likes_count: number;
    collects_count: number;
    comments_count: number;
    views_count: number;
    shares_count: number;
  };
  dataDate?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly redverseApiUrl: string;

  constructor(private configService: ConfigService) {
    this.redverseApiUrl =
      this.configService.get<string>('REDVERSE_API_URL') ||
      'http://localhost:3000';

    this.logger.log(
      '✅ Email service initialized with API URL:',
      this.redverseApiUrl,
    );
  }

  async sendNoteNotification(data: NoteNotificationData): Promise<{
    success: boolean;
    error?: string;
  }> {
    const maxRetries = 10;
    const baseDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const requestPayload = {
          ...data,
        };

        const response = await fetch(
          `${this.redverseApiUrl}/api/email/note-notification`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = (await response.json()) as {
          success: boolean;
          error?: string;
        };

        if (result.success) {
          return { success: true };
        } else {
          throw new Error(result.error ?? 'API returned failure response');
        }
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if it's a network-related error that might benefit from retry
        const isRetryableError =
          errorMessage.includes('fetch failed') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('AbortError') ||
          errorMessage.includes('HTTP 5') || // 5xx errors
          errorMessage.includes('ENOTFOUND') ||
          errorMessage.includes('ECONNREFUSED');

        if (!isRetryableError || isLastAttempt) {
          this.logger.error(
            `[Email Client] Email sending failed - project: "${data.projectName}", user: ${data.userId} (attempt ${attempt}/${maxRetries})`,
            {
              message: errorMessage,
              userId: data.userId,
              projectName: data.projectName,
              attempt,
              isRetryableError,
            },
          );

          return {
            success: false,
            error: errorMessage,
          };
        }

        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(
          `[Email Client] Retrying email sending - project: "${data.projectName}", user: ${data.userId} (attempt ${attempt}/${maxRetries}), error: ${errorMessage}, retrying in ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.logger.error(
      `[Email Client] All retry attempts failed - project: "${data.projectName}", user: ${data.userId}, maxRetries: ${maxRetries}`,
    );

    return {
      success: false,
      error: 'All retry attempts failed',
    };
  }
}
