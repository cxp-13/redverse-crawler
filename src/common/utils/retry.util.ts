interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  exponentialBackoff?: boolean;

  retryCondition?: (error: any) => boolean;
}

export class RetryUtil {
  /**
   * Executes a function with retry mechanism
   * @param fn Function to execute
   * @param options Retry options
   * @returns Promise result of the function
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
  ): Promise<T> {
    const {
      maxRetries,
      baseDelay,
      maxDelay = 30000, // 30 seconds max delay
      exponentialBackoff = true,
      retryCondition = (error: any) => RetryUtil.defaultRetryCondition(error),
    } = options;

    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastError = error;
        const isLastAttempt = attempt === maxRetries + 1;

        // Check if error should trigger a retry
        if (!retryCondition(error) || isLastAttempt) {
          throw error;
        }

        // Calculate delay with exponential backoff
        let delay = baseDelay;
        if (exponentialBackoff) {
          delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        }

        // Note: Using console.log instead of Logger to avoid circular dependencies
        console.log(
          `[RETRY] Attempt ${attempt}/${maxRetries} failed: ${
            error instanceof Error ? error.message : String(error)
          }. Retrying in ${delay}ms...`,
        );

        await RetryUtil.delay(delay);
      }
    }

    throw lastError;
  }

  /**
   * Default retry condition for network-related errors
   */

  static defaultRetryCondition(error: any): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return (
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('AbortError') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('socket hang up') ||
      errorMessage.includes('network timeout') ||
      errorMessage.includes('Request timeout')
    );
  }

  /**
   * Delay utility function
   */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
