import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request-context';

/** Deny by default: a route with @RequirePermissions passes only if the member holds all of them. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const tenant = ctx.switchToHttp().getRequest<AppRequest>().tenant;
    const missing = required.filter((p) => !tenant?.permissions.has(p));
    if (!tenant || missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    return true;
  }
}
