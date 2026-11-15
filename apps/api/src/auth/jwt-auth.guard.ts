import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request-context';

interface AccessPayload {
  sub?: unknown;
  sid?: unknown;
}

/**
 * Global guard: every route needs a valid Bearer access token unless marked @Public().
 * Access tokens are short-lived (15 min) and not checked against the session table on each
 * request; revocation takes effect at the next refresh.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const [scheme, token] = req.header('authorization')?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
    }

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Access token invalid or expired.',
      });
    }
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Access token invalid or expired.',
      });
    }

    req.user = { id: payload.sub, sessionId: payload.sid };
    return true;
  }
}
