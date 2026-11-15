import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth/auth.constants';
import { CurrentUser, Public } from '../common/decorators';
import { requestMeta, type AuthUser } from '../common/request-context';
import { AcceptInvitationDto, InvitationTokenDto } from './members.dto';
import { MembersService } from './members.service';

const LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** Invitee side of an invitation: preview, then accept with a new or an existing account. */
@Controller('invitations')
@Throttle(LIMIT)
export class InvitationsController {
  constructor(
    private readonly members: MembersService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('preview')
  preview(@Query() query: InvitationTokenDto) {
    return this.members.preview(query.token);
  }

  @Public()
  @Post('accept')
  async acceptNew(
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.members.acceptAsNewUser(dto, requestMeta(req));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
    return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
  }

  @Post('accept-existing')
  @HttpCode(200)
  acceptExisting(
    @CurrentUser() user: AuthUser,
    @Body() dto: InvitationTokenDto,
    @Req() req: Request,
  ) {
    return this.members.acceptAsExistingUser(dto.token, user.id, requestMeta(req));
  }
}
