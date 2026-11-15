import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@tasheel/shared';
import type { AppRequest, AuthUser, TenantInfo } from './request-context';

export const IS_PUBLIC_KEY = 'tasheel:isPublic';
export const PERMISSIONS_KEY = 'tasheel:permissions';
export const TENANT_SCOPED_KEY = 'tasheel:tenantScoped';

/** Route needs no access token. Everything else is authenticated by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Route requires an active organization (X-Organization-Id header) and ALL listed permissions.
 * Implies @TenantScoped().
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Route requires an active organization but no specific permission. */
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantInfo => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) throw new Error('CurrentTenant used on a route without tenant scope');
    return req.tenant;
  },
);
