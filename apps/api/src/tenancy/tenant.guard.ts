import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MFA_REQUIRED_ORG_TYPES,
  type OrganizationStatus,
  type OrganizationType,
} from '@tasheel/shared';
import { PERMISSIONS_KEY, TENANT_SCOPED_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export const ORGANIZATION_HEADER = 'x-organization-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Organizations in these states cannot act on the platform at all. */
const BLOCKED_STATUSES: readonly OrganizationStatus[] = ['SUSPENDED', 'REJECTED'];

interface MemberWithRoles {
  user: { mfaEnabled: boolean };
  organization: { type: OrganizationType; status: OrganizationStatus; deletedAt: Date | null };
  roles: Array<{ role: { permissions: Array<{ permissionCode: string }> } }>;
}

/**
 * Resolves the active organization from the X-Organization-Id header (the organization
 * switcher in the UI), checks the user is an ACTIVE member of it, and loads their
 * permissions. Runs after JwtAuthGuard. Required on routes marked @RequirePermissions
 * or @TenantScoped; ignored elsewhere.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const permissions = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const tenantScoped = this.reflector.getAllAndOverride<boolean | undefined>(
      TENANT_SCOPED_KEY,
      targets,
    );
    if (!permissions?.length && !tenantScoped) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied.' });

    const organizationId = req.header(ORGANIZATION_HEADER);
    if (!organizationId || !UUID_RE.test(organizationId)) {
      throw new BadRequestException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'Header X-Organization-Id with the active organization is required.',
      });
    }

    const userId = req.user.id;
    const member = (await this.prisma.forTenant({ organizationId, userId }, (tx) =>
      tx.organizationMember.findFirst({
        where: { organizationId, userId, status: 'ACTIVE', deletedAt: null },
        include: {
          user: { select: { mfaEnabled: true } },
          organization: { select: { type: true, status: true, deletedAt: true } },
          roles: {
            include: { role: { include: { permissions: { select: { permissionCode: true } } } } },
          },
        },
      }),
    )) as MemberWithRoles | null;

    // Same answer whether the organization does not exist or the user is not a member.
    if (!member || member.organization.deletedAt) {
      throw new ForbiddenException({
        code: 'NOT_A_MEMBER',
        message: 'You do not have access to this organization.',
      });
    }
    if (BLOCKED_STATUSES.includes(member.organization.status)) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_BLOCKED',
        message: 'This organization is suspended or rejected.',
      });
    }

    // Tasheel staff and bank users must enable MFA before acting in their organization.
    if (MFA_REQUIRED_ORG_TYPES.includes(member.organization.type) && !member.user.mfaEnabled) {
      throw new ForbiddenException({
        code: 'MFA_SETUP_REQUIRED',
        message: 'Two-factor authentication must be enabled to access this organization.',
      });
    }

    req.tenant = {
      userId,
      organizationId: organizationId.toLowerCase(),
      organizationType: member.organization.type,
      organizationStatus: member.organization.status,
      permissions: new Set(
        member.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)),
      ),
    };
    return true;
  }
}
