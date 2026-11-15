import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators';
import { requestMeta, type AuthUser } from '../../common/request-context';
import { MfaCodeDto, MfaDisableDto, MfaPasswordDto } from './mfa.dto';
import { MfaService } from './mfa.service';

const MFA_LIMIT = { default: { limit: 5, ttl: 60_000 } };

/** Managing two-factor authentication for the signed-in user. The login challenge is in AuthController. */
@Controller('auth/mfa')
@Throttle(MFA_LIMIT)
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser, @Body() dto: MfaPasswordDto, @Req() req: Request) {
    return this.mfa.startSetup(user.id, dto.password, requestMeta(req));
  }

  @Post('enable')
  @HttpCode(200)
  async enable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    return {
      recoveryCodes: await this.mfa.confirmSetup(
        user.id,
        user.sessionId,
        dto.code,
        requestMeta(req),
      ),
    };
  }

  @Post('disable')
  @HttpCode(204)
  async disable(
    @CurrentUser() user: AuthUser,
    @Body() dto: MfaDisableDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.mfa.disable(user.id, dto.password, dto.code, requestMeta(req));
  }

  @Post('recovery-codes')
  @HttpCode(200)
  async regenerate(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    return {
      recoveryCodes: await this.mfa.regenerateRecoveryCodes(user.id, dto.code, requestMeta(req)),
    };
  }
}
