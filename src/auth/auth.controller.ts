import {
  Controller,
  Get,
  Post,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AuthService, LoginStatus } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('status')
  async getStatus(): Promise<{ success: boolean; data: LoginStatus }> {
    try {
      const status = await this.authService.getSystemStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: '获取状态失败',
          error: error instanceof Error ? error.message : '未知错误',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('phone-login')
  async startPhoneLogin(@Body() body: { phoneNumber: string }) {
    try {
      const { phoneNumber } = body;

      if (!phoneNumber) {
        throw new HttpException(
          {
            success: false,
            message: '手机号不能为空',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 简单验证手机号格式
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(phoneNumber)) {
        throw new HttpException(
          {
            success: false,
            message: '手机号格式不正确',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const currentStatus = await this.authService.getSystemStatus();

      // 检查是否正在登录或更新中
      if (
        currentStatus.loginStatus === 'logging_in' ||
        currentStatus.loginStatus === 'waiting_sms_code'
      ) {
        throw new HttpException(
          {
            success: false,
            message: '正在登录中，请稍候',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (currentStatus.updateStatus === 'updating') {
        throw new HttpException(
          {
            success: false,
            message: '正在更新数据中，请稍候',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.authService.startPhoneLoginProcess(phoneNumber);

      if (result.error) {
        throw new HttpException(
          {
            success: false,
            message: result.error,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        message: '验证码已发送，请输入短信验证码',
        data: {
          phoneNumber,
          nextStep: 'submit_sms_code',
        },
      };
    } catch (error) {
      // 如果是已经抛出的HttpException，直接返回
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: '启动手机号登录失败',
          error: error instanceof Error ? error.message : '未知错误',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('submit-sms-code')
  async submitSmsCode(@Body() body: { smsCode: string }) {
    try {
      const { smsCode } = body;

      if (!smsCode) {
        throw new HttpException(
          {
            success: false,
            message: '验证码不能为空',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 简单验证验证码格式（通常是4-6位数字）
      const codeRegex = /^\d{4,6}$/;
      if (!codeRegex.test(smsCode)) {
        throw new HttpException(
          {
            success: false,
            message: '验证码格式不正确',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const currentStatus = await this.authService.getSystemStatus();

      // 检查是否处于等待验证码状态
      if (currentStatus.loginStatus !== 'waiting_sms_code') {
        throw new HttpException(
          {
            success: false,
            message: '请先发起手机号登录',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.authService.submitSmsCode(smsCode);

      if (result.error) {
        throw new HttpException(
          {
            success: false,
            message: result.error,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        message: '验证码提交成功，正在验证登录状态...',
        data: {
          nextStep: 'check_login_status',
        },
      };
    } catch (error) {
      // 如果是已经抛出的HttpException，直接返回
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: '提交验证码失败',
          error: error instanceof Error ? error.message : '未知错误',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
