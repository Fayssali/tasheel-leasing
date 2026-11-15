import type { Request } from 'express';
import type { OrganizationStatus, OrganizationType } from '@tasheel/shared';

/** Set by JwtAuthGuard from a valid access token. */
export interface AuthUser {
  id: string;
  sessionId: string;
}

/** Set by TenantGuard after checking active membership in the organization. */
export interface TenantInfo {
  userId: string;
  organizationId: string;
  organizationType: OrganizationType;
  organizationStatus: OrganizationStatus;
  permissions: ReadonlySet<string>;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  tenant?: TenantInfo;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 500) ?? null,
  };
}
