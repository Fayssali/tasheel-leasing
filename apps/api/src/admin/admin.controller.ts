import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { AuditQueryDto, OrganizationListQueryDto, StatusChangeDto } from './admin.dto';
import { AdminService } from './admin.service';

/**
 * Tasheel back-office API. Every route requires a PLATFORM-only permission, so it is
 * reachable only with X-Organization-Id set to the platform organization, by a member
 * who has enabled MFA (enforced by TenantGuard for platform members).
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('kpis')
  @RequirePermissions('admin.kpi.read')
  kpis(@CurrentTenant() tenant: TenantInfo) {
    return this.admin.kpis(tenant);
  }

  @Get('organizations')
  @RequirePermissions('admin.organization.read')
  list(@CurrentTenant() tenant: TenantInfo, @Query() query: OrganizationListQueryDto) {
    return this.admin.listOrganizations(tenant, query);
  }

  @Get('organizations/:id')
  @RequirePermissions('admin.organization.read')
  get(@CurrentTenant() tenant: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getOrganization(tenant, id);
  }

  @Post('organizations/:id/verify')
  @HttpCode(200)
  @RequirePermissions('admin.organization.verify')
  verify(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusChangeDto,
    @Req() req: Request,
  ) {
    return this.admin.changeStatus(t, id, 'verify', dto.reason, requestMeta(req));
  }

  @Post('organizations/:id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.organization.verify')
  reject(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusChangeDto,
    @Req() req: Request,
  ) {
    return this.admin.changeStatus(t, id, 'reject', dto.reason, requestMeta(req));
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.organization.verify')
  suspend(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusChangeDto,
    @Req() req: Request,
  ) {
    return this.admin.changeStatus(t, id, 'suspend', dto.reason, requestMeta(req));
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(200)
  @RequirePermissions('admin.organization.verify')
  reactivate(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusChangeDto,
    @Req() req: Request,
  ) {
    return this.admin.changeStatus(t, id, 'reactivate', dto.reason, requestMeta(req));
  }

  @Get('audit-logs')
  @RequirePermissions('admin.audit.read')
  auditLogs(@CurrentTenant() tenant: TenantInfo, @Query() query: AuditQueryDto) {
    return this.admin.auditLogs(tenant, query);
  }
}
