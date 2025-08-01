import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 不使用全局API前缀

  // 启用CORS - 允许所有跨域请求
  app.enableCors({
    origin: true, // 允许所有来源
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const preferredPort = parseInt(process.env.API_PORT || '3000', 10);
  let actualPort: number;

  try {
    await app.listen(preferredPort);
    actualPort = preferredPort;
    logger.log(`✅ Server started successfully on port ${actualPort}`);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ) {
      logger.warn(
        `⚠️ Port ${preferredPort} is in use, trying to find available port...`,
      );
      // 让系统自动分配端口
      await app.listen(0);
      // 获取实际分配的端口
      try {
        const server = app.getHttpServer() as import('http').Server;
        const address = server.address();
        if (address && typeof address === 'object' && 'port' in address) {
          actualPort = (address as { port: number }).port;
        } else {
          actualPort = 0;
        }
      } catch {
        actualPort = 0;
      }
      logger.log(
        `✅ Server started on automatically assigned port ${actualPort}`,
      );
    } else {
      logger.error('❌ Failed to start server:', error);
      throw error;
    }
  }

  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('🚀 XIAOHONGSHU AUTO UPDATE SERVICE STARTED');
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log(`📍 API Server: http://localhost:${actualPort}`);
  logger.log('');
  logger.log('📋 Available APIs:');
  logger.log(
    `   POST http://localhost:${actualPort}/auth/phone-login  - 手机号登录`,
  );
  logger.log(
    `   POST http://localhost:${actualPort}/auth/submit-sms-code - 提交短信验证码`,
  );
  logger.log(
    `   GET http://localhost:${actualPort}/auth/status   - 查看登录和更新状态`,
  );
  logger.log('');
  logger.log('🔄 工作流程:');
  logger.log('   1. 调用 phone-login 输入手机号');
  logger.log('   2. 调用 submit-sms-code 输入短信验证码');
  logger.log('   3. 自动更新所有笔记数据');
  logger.log('   4. 调用 status 查看进度');
  logger.log('═══════════════════════════════════════════════════════════');
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
