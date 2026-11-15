import { Controller, Get, NotFoundException } from '@nestjs/common';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import type { TenantInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** Read endpoints for the active organization. Profile editing comes with the onboarding screens. */
@Controller('organizations/current')
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('organization.read')
  async current(@CurrentTenant() tenant: TenantInfo) {
    const org = await this.prisma.forTenant(tenant, (tx) =>
      tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: {
          id: true,
          type: true,
          status: true,
          statusReason: true,
          legalName: true,
          tradeName: true,
          rcNumber: true,
          nif: true,
          nis: true,
          articleImposition: true,
          wilayaCode: true,
          address: true,
          email: true,
          phone: true,
          defaultLocale: true,
          verifiedAt: true,
          createdAt: true,
        },
      }),
    );
    if (!org) throw new NotFoundException();
    return { ...org, permissions: [...tenant.permissions].sort() };
  }

  @Get('members')
  @RequirePermissions('member.read')
  async members(@CurrentTenant() tenant: TenantInfo) {
    const members = await this.prisma.forTenant(tenant, (tx) =>
      tx.organizationMember.findMany({
        where: { organizationId: tenant.organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          createdAt: true,
          // Never select password_hash or mfa_secret.
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          roles: { select: { role: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return members;
  }
}
