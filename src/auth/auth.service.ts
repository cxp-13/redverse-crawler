import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page } from 'puppeteer';
import { BrowserService } from '../browser/browser.service';
import { RedisService } from '../redis/redis.service';

export interface LoginStatus {
  loginStatus: 'idle' | 'logging_in' | 'waiting_sms_code' | 'logged_in' | 'failed';
  updateStatus: 'idle' | 'updating' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    failed: number;
  };
  lastUpdate?: Date;
  error?: string;
}

export interface PhoneLoginConfig {
  phoneNumber: string;
  verificationCode?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly XHS_LOGIN_URL = 'https://www.xiaohongshu.com/explore';
  private readonly LOGIN_CHECK_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[1]'; // 登录界面特有元素
  
  // 手机号登录相关XPath
  private readonly PHONE_INPUT_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[2]/form/label[1]/input';
  private readonly GET_CODE_BUTTON_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[2]/form/label[2]/span';
  private readonly SMS_CODE_INPUT_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[2]/form/label[2]/input';
  private readonly AGREE_CHECKBOX_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[3]/span/div';
  private readonly LOGIN_BUTTON_XPATH = '//*[@id="app"]/div[1]/div/div[1]/div[3]/div[2]/form/button';
  
  // 状态管理
  private systemStatus: LoginStatus = {
    loginStatus: 'idle',
    updateStatus: 'idle',
    progress: {
      total: 0,
      processed: 0,
      failed: 0,
    },
  };

  // 当前会话管理
  private currentSession: {
    page: Page | null;
    phoneNumber: string | null;
    startTime: number;
    isWaitingForSmsCode: boolean;
  } = {
    page: null,
    phoneNumber: null,
    startTime: 0,
    isWaitingForSmsCode: false,
  };

  // 认证页面池 - 用于复用
  private authenticatedPage: Page | null = null;

  // 登录成功回调
  private onLoginSuccess: (() => void) | null = null;

  constructor(
    private browserService: BrowserService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  // 设置登录成功回调
  setLoginSuccessCallback(callback: () => void): void {
    this.onLoginSuccess = callback;
  }

  // 获取系统状态 - 从Redis读取
  async getSystemStatus(): Promise<LoginStatus> {
    try {
      const redisStatus = await this.redisService.getProgress();
      if (redisStatus) {
        return redisStatus;
      }
      // 如果Redis中没有数据，返回内存中的默认状态
      return { ...this.systemStatus };
    } catch (error) {
      this.logger.error('Failed to get status from Redis, using memory status:', error);
      return { ...this.systemStatus };
    }
  }

  // 更新系统状态 - 同时更新内存和Redis
  async updateSystemStatus(updates: Partial<LoginStatus>): Promise<void> {
    // 更新内存状态
    this.systemStatus = { ...this.systemStatus, ...updates };
    if (updates.progress) {
      this.systemStatus.progress = { ...this.systemStatus.progress, ...updates.progress };
    }
    
    // 设置最后更新时间
    this.systemStatus.lastUpdate = new Date();
    
    // 同步到Redis
    try {
      await this.redisService.setProgress(this.systemStatus);
      this.logger.debug('System status updated in Redis');
    } catch (error) {
      this.logger.error('Failed to update status in Redis:', error);
      // 继续执行，不因Redis错误中断业务逻辑
    }
  }

  // 启动手机号登录流程
  async startPhoneLoginProcess(phoneNumber: string): Promise<{ success?: boolean; error?: string }> {
    try {
      // 清理之前的会话
      await this.cleanupSession();

      // 更新状态
      await this.updateSystemStatus({ 
        loginStatus: 'logging_in',
        error: undefined 
      });

      // 创建新页面
      const page = await this.browserService.createPage();
      this.currentSession.page = page;
      this.currentSession.phoneNumber = phoneNumber;
      this.currentSession.startTime = Date.now();

      // 导航到登录页面
      this.logger.log('Navigating to Xiaohongshu login page...');
      await page.goto(this.XHS_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      // 切换到手机号登录模式
      await this.switchToPhoneLogin(page);

      // 输入手机号
      await this.inputPhoneNumber(page, phoneNumber);

      // 点击同意协议
      await this.agreeToTerms(page);

      // 获取验证码
      await this.requestSmsCode(page);

      // 更新状态为等待短信验证码
      await this.updateSystemStatus({ loginStatus: 'waiting_sms_code' });
      this.currentSession.isWaitingForSmsCode = true;

      this.logger.log('SMS code requested successfully. Please call submitSmsCode() with the received code.');

      return { success: true };

    } catch (error) {
      this.logger.error('Failed to start phone login process:', error);
      await this.updateSystemStatus({ 
        loginStatus: 'failed',
        error: error.message 
      });
      await this.cleanupSession();
      return { error: error.message };
    }
  }

  // 提交短信验证码
  async submitSmsCode(smsCode: string): Promise<{ success?: boolean; error?: string }> {
    try {
      if (!this.currentSession.page || !this.currentSession.isWaitingForSmsCode) {
        throw new Error('No active phone login session or not waiting for SMS code');
      }

      const page = this.currentSession.page;

      // 输入验证码
      await this.inputSmsCode(page, smsCode);

      // 点击登录按钮
      await this.submitLogin(page);

      // 启动登录监听
      this.startLoginMonitoring();

      return { success: true };

    } catch (error) {
      this.logger.error('Failed to submit SMS code:', error);
      await this.updateSystemStatus({ 
        loginStatus: 'failed',
        error: error.message 
      });
      await this.cleanupSession();
      return { error: error.message };
    }
  }

  // 切换到手机号登录模式
  private async switchToPhoneLogin(page: Page): Promise<void> {
    try {
      // 寻找手机号登录切换按钮（通常在二维码登录旁边）
      const phoneLoginButton = await page.$x('//span[contains(text(), "手机号登录")]');
      if (phoneLoginButton.length > 0) {
        await (phoneLoginButton[0] as any).click();
        await page.waitForTimeout(2000);
        this.logger.log('Switched to phone login mode');
      } else {
        this.logger.log('Already in phone login mode or button not found');
      }
    } catch (error) {
      this.logger.warn('Could not switch to phone login mode:', error);
    }
  }

  // 输入手机号
  private async inputPhoneNumber(page: Page, phoneNumber: string): Promise<void> {
    const phoneInput = await page.$x(this.PHONE_INPUT_XPATH);
    if (phoneInput.length === 0) {
      throw new Error('Phone input field not found');
    }

    await (phoneInput[0] as any).click();
    await page.waitForTimeout(500);
    
    // 清空输入框
    await phoneInput[0].focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    // 输入手机号
    await phoneInput[0].type(phoneNumber, { delay: 100 });
    this.logger.log(`Phone number entered: ${phoneNumber}`);
  }

  // 勾选同意协议
  private async agreeToTerms(page: Page): Promise<void> {
    try {
      const checkbox = await page.$x(this.AGREE_CHECKBOX_XPATH);
      if (checkbox.length > 0) {
        await (checkbox[0] as any).click();
        await page.waitForTimeout(500);
        this.logger.log('Terms agreement checked');
      }
    } catch (error) {
      this.logger.warn('Could not check terms agreement:', error);
    }
  }

  // 请求短信验证码
  private async requestSmsCode(page: Page): Promise<void> {
    const getCodeButton = await page.$x(this.GET_CODE_BUTTON_XPATH);
    if (getCodeButton.length === 0) {
      throw new Error('Get verification code button not found');
    }

    await (getCodeButton[0] as any).click();
    await page.waitForTimeout(2000);
    this.logger.log('SMS verification code requested');
  }

  // 输入短信验证码
  private async inputSmsCode(page: Page, smsCode: string): Promise<void> {
    const smsInput = await page.$x(this.SMS_CODE_INPUT_XPATH);
    if (smsInput.length === 0) {
      throw new Error('SMS code input field not found');
    }

    await (smsInput[0] as any).click();
    await page.waitForTimeout(500);
    
    // 清空输入框
    await smsInput[0].focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    // 输入验证码
    await smsInput[0].type(smsCode, { delay: 100 });
    this.logger.log('SMS code entered');
  }

  // 提交登录
  private async submitLogin(page: Page): Promise<void> {
    const loginButton = await page.$x(this.LOGIN_BUTTON_XPATH);
    if (loginButton.length === 0) {
      throw new Error('Login button not found');
    }

    await (loginButton[0] as any).click();
    await page.waitForTimeout(2000);
    this.logger.log('Login form submitted');
  }

  // 启动5分钟登录监听
  private async startLoginMonitoring(): Promise<void> {
    const checkInterval = 1000; // 每秒检查一次
    const timeout = 300000; // 5分钟超时
    let elapsed = 0;

    const timer = setInterval(async () => {
      elapsed += checkInterval;

      if (!this.currentSession.page || elapsed >= timeout) {
        clearInterval(timer);
        
        if (elapsed >= timeout) {
          this.logger.warn('Login timeout after 5 minutes');
          await this.updateSystemStatus({ 
            loginStatus: 'failed',
            error: 'Login timeout' 
          });
          await this.cleanupAuthenticatedPage();
        }
        
        await this.cleanupSession();
        return;
      }

      try {
        const isLoggedIn = await this.checkLoginStatus(this.currentSession.page);
        
        if (isLoggedIn) {
          clearInterval(timer);
          this.logger.log('✅ Login successful!');
          await this.updateSystemStatus({ loginStatus: 'logged_in' });
          
          // 触发登录成功回调（开始数据更新）
          if (this.onLoginSuccess) {
            setTimeout(() => this.onLoginSuccess!(), 1000);
          }
          
          await this.cleanupSession();
        } else {
          const remainingSeconds = Math.floor((timeout - elapsed) / 1000);
          const minutes = Math.floor(remainingSeconds / 60);
          const seconds = remainingSeconds % 60;
          this.logger.log(`⏱️ Checking login status... ${minutes}m ${seconds}s remaining`);
        }
      } catch (error) {
        this.logger.error('Error checking login status:', error);
      }
    }, checkInterval);
  }

  // 检查登录状态
  private async checkLoginStatus(page: Page): Promise<boolean> {
    try {
      // 检查登录界面特有元素是否存在
      const loginElements = await page.$x(this.LOGIN_CHECK_XPATH);
      
      if (loginElements.length > 0) {
        const elementText = await page.evaluate((element) => {
          return element ? element.textContent || '' : '';
        }, loginElements[0]);
        
        // 如果还能找到"手机号登录"元素，说明还在登录页面
        return !elementText.includes('手机号登录');
      }
      
      // 找不到登录元素，说明已经登录
      return true;
    } catch (error) {
      this.logger.warn('Error checking login element:', error);
      return false;
    }
  }

  // 清理会话
  private async cleanupSession(): Promise<void> {
    if (this.currentSession.page && !this.currentSession.page.isClosed()) {
      try {
        await this.currentSession.page.close();
      } catch (error) {
        this.logger.warn('Error closing page:', error);
      }
    }
    
    this.currentSession = {
      page: null,
      phoneNumber: null,
      startTime: 0,
      isWaitingForSmsCode: false,
    };
  }

  // 清理认证页面（在登录失败或退出时调用）
  async cleanupAuthenticatedPage(): Promise<void> {
    if (this.authenticatedPage && !this.authenticatedPage.isClosed()) {
      try {
        await this.authenticatedPage.close();
        this.logger.log('Authenticated page closed');
      } catch (error) {
        this.logger.warn('Error closing authenticated page:', error);
      }
    }
    this.authenticatedPage = null;
  }

  // 获取已认证的页面（供CrawlerService使用）- 支持页面复用
  async getAuthenticatedPage(): Promise<Page | null> {
    if (this.systemStatus.loginStatus !== 'logged_in') {
      this.logger.warn('Not logged in, cannot create authenticated page');
      return null;
    }

    // 检查现有认证页面是否可用
    if (this.authenticatedPage && !this.authenticatedPage.isClosed()) {
      try {
        // 验证页面是否仍然处于登录状态
        const isLoggedIn = await this.checkLoginStatus(this.authenticatedPage);
        if (isLoggedIn) {
          this.logger.log('Reusing existing authenticated page');
          return this.authenticatedPage;
        } else {
          this.logger.warn('Existing page is no longer authenticated, creating new one');
          if (this.authenticatedPage) {
            await this.authenticatedPage.close();
          }
          this.authenticatedPage = null;
        }
      } catch (error) {
        this.logger.warn('Error checking existing page, creating new one:', error);
        if (this.authenticatedPage) {
          await this.authenticatedPage.close();
        }
        this.authenticatedPage = null;
      }
    }

    // 创建新的认证页面
    const page = await this.browserService.createPage();
    await page.goto(this.XHS_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // 验证是否仍然处于登录状态
    const isLoggedIn = await this.checkLoginStatus(page);
    if (!isLoggedIn) {
      await page.close();
      await this.updateSystemStatus({ loginStatus: 'idle' });
      return null;
    }

    // 缓存页面供复用
    this.authenticatedPage = page;
    this.logger.log('Created new authenticated page for reuse');
    return page;
  }

  // 清理页面内容，准备访问新URL
  async cleanPageForNewUrl(page: Page): Promise<void> {
    try {
      // 清除页面内容，但不关闭页面
      await page.evaluate(() => {
        // 清除当前页面内容
        document.body.innerHTML = '';
        // 清除可能的缓存
        if ('caches' in window) {
          caches.keys().then(names => {
            names.forEach(name => caches.delete(name));
          });
        }
      });
      
      this.logger.debug('Page content cleaned for new URL');
    } catch (error) {
      this.logger.warn('Error cleaning page content:', error);
    }
  }
}