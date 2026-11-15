import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import { requestMeta, type AuthUser } from '../common/request-context';
import { AccountService } from './account.service';
import { EmailTokenDto, ForgotPasswordDto, ResetPasswordDto } from './dto/account.dto';

@Controller('auth')
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(private readonly account: AccountService) {}

  /** Re-send the verification link to the signed-in user. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('email/verification')
  @HttpCode(202)
  async requestVerification(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return { status: await this.account.sendEmailVerification(user.id, requestMeta(req)) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('email/verify')
  @HttpCode(204)
  async verify(@Body() dto: EmailTokenDto, @Req() req: Request): Promise<void> {
    await this.account.confirmEmail(dto.token, requestMeta(req));
  }

  /**
   * Always answers 202 immediately, whether or not the email exists, and does the work in
   * the background so response time reveals nothing.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(202)
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request): { status: 'accepted' } {
    void this.account.forgotPassword(dto.email, requestMeta(req)).catch((err: unknown) => {
      this.logger.error(
        `forgotPassword failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return { status: 'accepted' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<void> {
    await this.account.resetPassword(dto.token, dto.password, requestMeta(req));
  }
}
