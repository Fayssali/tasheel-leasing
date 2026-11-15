import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { InviteDto, UpdateMemberDto } from './members.dto';
import { MembersService } from './members.service';
import { UpdateOrganizationDto, LEGAL_IDENTITY_FIELDS } from './organization.dto';

const PROFILE_SELECT = {
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
} as const;

/** The active organization (X-Organization-Id): profile, members and invitations. */
@Controller('organizations/current')
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('organization.read')
  async current(@CurrentTenant() tenant: TenantInfo) {
    const org = await this.prisma.forTenant(tenant, (tx) =>
      tx.organization.findUnique({ where: { id: tenant.organizationId }, select: PROFILE_SELECT }),
    );
    if (!org) throw new NotFoundException();
    return { ...org, permissions: [...tenant.permissions].sort() };
  }

  /**
   * Legal identity (legal name, RC, NIF, NIS, article) can be edited only before
   * verification; afterwards a change goes through Tasheel support, so a verified identity
   * cannot be swapped silently.
   */
  @Patch()
  @RequirePermissions('organization.update')
  async update(
    @CurrentTenant() tenant: TenantInfo,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: Request,
  ) {
    const touchesIdentity = LEGAL_IDENTITY_FIELDS.some((f) => dto[f] !== undefined);
    if (touchesIdentity && tenant.organizationStatus === 'VERIFIED') {
      throw new ForbiddenException({
        code: 'IDENTITY_LOCKED',
        message:
          'Legal identifiers of a verified organization can only be changed through support.',
      });
    }
    return this.prisma.forTenant(tenant, async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: PROFILE_SELECT,
      });
      const updated = await tx.organization.update({
        where: { id: tenant.organizationId },
        data: dto,
        select: PROFILE_SELECT,
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: tenant.organizationId,
        diff: { before: before ?? undefined, after: dto as Record<string, unknown> },
        meta: requestMeta(req),
      });
      return updated;
    });
  }

  @Get('members')
  @RequirePermissions('member.read')
  async listMembers(@CurrentTenant() tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.organizationMember.findMany({
        where: { organizationId: tenant.organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          createdAt: true,
          // Never select password_hash or mfa_secret.
          user: {
            select: { id: true, email: true, firstName: true, lastName: true, mfaEnabled: true },
          },
          roles: { select: { role: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  @Patch('members/:id')
  @RequirePermissions('member.manage')
  updateMember(
    @CurrentTenant() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: Request,
  ) {
    return this.members.updateMember(tenant, id, dto, requestMeta(req));
  }

  @Get('roles')
  @RequirePermissions('member.read')
  roles(@CurrentTenant() tenant: TenantInfo) {
    return this.members.assignableRoles(tenant);
  }

  @Get('invitations')
  @RequirePermissions('member.read')
  listInvitations(@CurrentTenant() tenant: TenantInfo) {
    return this.members.listInvitations(tenant);
  }

  @Post('invitations')
  @RequirePermissions('member.invite')
  invite(@CurrentTenant() tenant: TenantInfo, @Body() dto: InviteDto, @Req() req: Request) {
    return this.members.invite(tenant, dto, requestMeta(req));
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions('member.invite')
  async revoke(
    @CurrentTenant() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.members.revokeInvitation(tenant, id, requestMeta(req));
  }
}
