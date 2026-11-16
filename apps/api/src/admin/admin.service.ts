import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Locale, OrganizationStatus, OrganizationType } from '@tasheel/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Notifier, type Recipient } from '../mail/notifier';
import { PrismaService } from '../prisma/prisma.service';

export type AdminAction = 'verify' | 'reject' | 'suspend' | 'reactivate';

interface OrgRow {
  id: string;
  type: OrganizationType;
  status: OrganizationStatus;
  legalName: string;
  email: string | null;
  defaultLocale: Locale;
  verifiedAt: Date | null;
}

/**
 * Allowed status transitions. The platform organization itself is never a target.
 * Reactivating returns to VERIFIED if the organization had been verified before,
 * otherwise back to the verification queue.
 */
const TRANSITIONS: Record<AdminAction, readonly OrganizationStatus[]> = {
  verify: ['PENDING_VERIFICATION', 'REJECTED'],
  reject: ['PENDING_VERIFICATION'],
  suspend: ['PENDING_VERIFICATION', 'VERIFIED'],
  reactivate: ['SUSPENDED'],
};

const NEEDS_REASON: readonly AdminAction[] = ['reject', 'suspend'];

export interface OrganizationListQuery {
  status?: OrganizationStatus;
  type?: OrganizationType;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditQuery {
  organizationId?: string;
  action?: string;
  actorUserId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Tasheel back-office. Runs in the platform organization's tenant context, where the RLS
 * function app_is_platform() lets reads and status updates cross tenants. Every write is
 * audited against the TARGET organization, so the change shows up in its own history too.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  async listOrganizations(tenant: TenantInfo, query: OrganizationListQuery) {
    const take = Math.min(query.limit ?? 25, 100);
    const rows = (await this.prisma.forTenant(tenant, (tx) =>
      tx.organization.findMany({
        where: {
          deletedAt: null,
          type: query.type ? query.type : { not: 'PLATFORM' },
          ...(query.status ? { status: query.status } : {}),
          ...(query.q
            ? {
                OR: [
                  { legalName: { contains: query.q, mode: 'insensitive' } },
                  { tradeName: { contains: query.q, mode: 'insensitive' } },
                  { nif: { contains: query.q } },
                  { rcNumber: { contains: query.q } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          status: true,
          legalName: true,
          tradeName: true,
          wilayaCode: true,
          nif: true,
          rcNumber: true,
          createdAt: true,
          verifiedAt: true,
          _count: { select: { members: true } },
        },
        // Oldest first for the verification queue, newest first otherwise.
        orderBy: [
          { createdAt: query.status === 'PENDING_VERIFICATION' ? 'asc' : 'desc' },
          { id: 'asc' },
        ],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    )) as Array<{ id: string }>;

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async getOrganization(tenant: TenantInfo, id: string) {
    const org = await this.prisma.forTenant(tenant, (tx) =>
      tx.organization.findUnique({
        where: { id },
        include: {
          members: {
            where: { deletedAt: null },
            select: {
              id: true,
              status: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  emailVerifiedAt: true,
                  mfaEnabled: true,
                  lastLoginAt: true,
                },
              },
              roles: { select: { role: { select: { code: true, name: true } } } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    );
    if (!org)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found.' });
    return org;
  }

  async changeStatus(
    tenant: TenantInfo,
    id: string,
    action: AdminAction,
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    if (NEEDS_REASON.includes(action) && !reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required for this action.',
      });
    }

    const { org, next, recipients } = await this.prisma.forTenant(tenant, async (tx) => {
      const org = (await tx.organization.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          status: true,
          legalName: true,
          email: true,
          defaultLocale: true,
          verifiedAt: true,
        },
      })) as OrgRow | null;
      if (!org)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found.' });
      if (org.type === 'PLATFORM') {
        throw new BadRequestException({
          code: 'PLATFORM_IMMUTABLE',
          message: 'The platform organization cannot be changed here.',
        });
      }
      if (!TRANSITIONS[action].includes(org.status)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Cannot ${action} an organization whose status is ${org.status}.`,
        });
      }

      const next: OrganizationStatus =
        action === 'verify'
          ? 'VERIFIED'
          : action === 'reject'
            ? 'REJECTED'
            : action === 'suspend'
              ? 'SUSPENDED'
              : org.verifiedAt
                ? 'VERIFIED'
                : 'PENDING_VERIFICATION';

      // Conditional on the status read above: a concurrent decision by another agent wins, not both.
      const { count } = await tx.organization.updateMany({
        where: { id, status: org.status },
        data: {
          status: next,
          statusReason: NEEDS_REASON.includes(action) ? reason!.trim() : null,
          ...(action === 'verify' ? { verifiedAt: new Date(), verifiedById: tenant.userId } : {}),
        },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE',
          message: 'The organization was changed meanwhile. Reload.',
        });

      await this.audit.record(tx, {
        organizationId: id,
        actorUserId: tenant.userId,
        action: `organization.${action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : action === 'suspend' ? 'suspended' : 'reactivated'}`,
        entityType: 'Organization',
        entityId: id,
        diff: { before: org.status, after: next, reason: reason?.trim() },
        meta,
      });

      // Notify the organization's administrators (members who can manage the team).
      const admins = (await tx.organizationMember.findMany({
        where: {
          organizationId: id,
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { permissions: { some: { permissionCode: 'member.manage' } } } } },
        },
        select: { user: { select: { id: true, email: true, firstName: true, locale: true } } },
      })) as Array<{ user: Recipient }>;
      return { org, next, recipients: admins.map((a) => a.user) };
    });

    const key =
      next === 'VERIFIED'
        ? 'email.orgVerified'
        : next === 'REJECTED'
          ? 'email.orgRejected'
          : next === 'SUSPENDED'
            ? 'email.orgSuspended'
            : null;
    if (key) {
      // Email and in-app notification for the organization's administrators.
      void this.notifier.send(
        id,
        recipients,
        key,
        () => ({ organization: org.legalName, reason: reason?.trim() ?? '' }),
        '/app/organization',
      );
    }
    return { id, status: next };
  }

  async auditLogs(tenant: TenantInfo, query: AuditQuery) {
    const take = Math.min(query.limit ?? 50, 200);
    const rows = (await this.prisma.forTenant(tenant, (tx) =>
      tx.auditLog.findMany({
        where: {
          ...(query.organizationId ? { organizationId: query.organizationId } : {}),
          ...(query.action ? { action: { startsWith: query.action } } : {}),
          ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    )) as Array<{ id: string }>;
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  /** Phase 1 platform KPIs (Phase 0 specification, section 6, M9). Business KPIs arrive with their modules. */
  async kpis(tenant: TenantInfo) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    return this.prisma.forTenant(tenant, async (tx) => {
      // Plain SQL: Prisma's groupBy typings do not resolve inside interactive transactions.
      const byTypeStatus = (await tx.$queryRaw`
        SELECT type::text AS type, status::text AS status, count(*)::int AS n
        FROM organizations
        WHERE deleted_at IS NULL AND type <> 'PLATFORM'
        GROUP BY type, status`) as Array<{
        type: OrganizationType;
        status: OrganizationStatus;
        n: number;
      }>;
      const [users, newOrganizations30d] = await Promise.all([
        tx.user.count({ where: { deletedAt: null } }),
        tx.organization.count({
          where: { deletedAt: null, type: { not: 'PLATFORM' }, createdAt: { gte: since } },
        }),
      ]);

      const organizations: Record<string, Record<string, number>> = {};
      for (const row of byTypeStatus) {
        organizations[row.type] ??= {};
        organizations[row.type]![row.status] = row.n;
      }
      const pendingVerification = byTypeStatus
        .filter((r) => r.status === 'PENDING_VERIFICATION')
        .reduce((sum, r) => sum + r.n, 0);

      return {
        organizations,
        pendingVerification,
        users,
        newOrganizations30d,
        generatedAt: new Date().toISOString(),
      };
    });
  }
}
