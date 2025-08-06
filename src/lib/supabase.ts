import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error(
        '[DATABASE] Missing Supabase configuration: URL or ANON_KEY not provided',
      );
      throw new Error('Supabase URL and Anon Key must be provided');
    }

    this.logger.log(`[DATABASE] Connecting to Supabase at: ${supabaseUrl}`);

    try {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        db: {
          schema: 'public',
        },
        auth: {
          persistSession: false,
        },
        global: {
          fetch: (url: string | URL | Request, options = {}) => {
            const timeout = 30000; // 30 seconds timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            return fetch(url, {
              ...options,
              signal: controller.signal,
            }).finally(() => {
              clearTimeout(timeoutId);
            });
          },
        },
      });
      this.logger.log('[DATABASE] ✅ Supabase client initialized successfully');
    } catch (error) {
      this.logger.error(
        '[DATABASE] ❌ Failed to initialize Supabase client:',
        error,
      );
      throw error;
    }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }
}
