# Redverse Crawler - Xiaohongshu Data Crawler

🚀 An automated web crawler for collecting and updating Xiaohongshu (Little Red Book) note data with real-time email notifications.

## Features

- 🔐 **Phone-based Login**: Automated SMS verification for Xiaohongshu login
- 📊 **Data Crawling**: Extracts likes, views, collects, comments, and shares data
- 📧 **Email Notifications**: Sends beautiful email notifications when data changes
- 🔄 **Real-time Updates**: Live progress tracking with Redis caching
- 🎯 **Smart Filtering**: Only sends notifications when meaningful changes occur
- 🏗️ **Scalable Architecture**: Built with NestJS and TypeScript

## Tech Stack

- **Backend**: NestJS, TypeScript
- **Web Scraping**: Puppeteer with stealth plugin
- **Database**: Supabase (PostgreSQL)
- **Cache**: Upstash Redis
- **Email**: Resend
- **Authentication**: Clerk (for user management)

## Installation

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Configure environment variables
4. Build: `pnpm run build`
5. Start: `pnpm run start:prod`

## Environment Variables

```env
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
PUPPETEER_HEADLESS=false
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
CLERK_SECRET_KEY=your_clerk_secret
RESEND_API_KEY=your_resend_key
ADMIN_EMAIL=your_admin_email
API_PORT=3001
```

## API Endpoints

- `POST /auth/phone-login` - Start phone login
- `POST /auth/submit-sms-code` - Submit SMS code
- `GET /progress` - Get crawling progress
- `GET /progress/clear` - Clear progress data

Built with ❤️ for [Redverse](https://redverse.online)