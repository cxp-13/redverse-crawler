import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private clerkClient: ReturnType<typeof createClerkClient>;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) {
      this.logger.error('CLERK_SECRET_KEY is not configured');
      throw new Error('CLERK_SECRET_KEY must be provided');
    }

    this.clerkClient = createClerkClient({
      secretKey: secretKey,
    });

    this.logger.log('✅ Clerk client initialized');
  }

  async getUserEmailByUserId(userId: string): Promise<string | null> {
    try {
      this.logger.debug(`Getting user email for userId: ${userId}`);

      const user = await this.clerkClient.users.getUser(userId);

      if (!user) {
        this.logger.warn(`User not found for userId: ${userId}`);
        return null;
      }

      const primaryEmail = user.emailAddresses.find(
        (email) => email.id === user.primaryEmailAddressId,
      );
      if (primaryEmail) {
        this.logger.debug(
          `Found primary email for userId ${userId}: ${primaryEmail.emailAddress}`,
        );
        return primaryEmail.emailAddress;
      }

      // Fallback to first email address if primary is not found
      if (user.emailAddresses.length > 0) {
        const fallbackEmail = user.emailAddresses[0].emailAddress;
        this.logger.debug(
          `Using fallback email for userId ${userId}: ${fallbackEmail}`,
        );
        return fallbackEmail;
      }

      this.logger.warn(`No email addresses found for userId: ${userId}`);
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to get user email for userId ${userId}:`,
        error,
      );
      return null;
    }
  }

  async getUserInfo(userId: string): Promise<{
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
  } | null> {
    try {
      this.logger.debug(`Getting user info for userId: ${userId}`);

      const user = await this.clerkClient.users.getUser(userId);

      if (!user) {
        this.logger.warn(`User not found for userId: ${userId}`);
        return null;
      }

      const primaryEmail = user.emailAddresses.find(
        (email) => email.id === user.primaryEmailAddressId,
      );
      const email =
        primaryEmail?.emailAddress ||
        user.emailAddresses[0]?.emailAddress ||
        null;

      return {
        email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
      };
    } catch (error) {
      this.logger.error(`Failed to get user info for userId ${userId}:`, error);
      return null;
    }
  }
}
