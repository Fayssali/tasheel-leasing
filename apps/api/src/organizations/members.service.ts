import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantTx } from '@tasheel/db';
import type { Locale } from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { AuthService, type IssuedTokens } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import {
  digestEquals,
  formatInvitationToken,
  newSecret,
  parseInvitationToken,
  sha256,
} from '../auth/tokens';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Mailer } from '../mail/mailer';
import { buildMail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';

export const INVITATION_TTL_DAYS = 7;
const MANAGE_PERMISSION = 'member.manage';

const INVALID_INVITATION = {
  code: 'INVALID_INVITATION',
  message: 'This invitation is invalid, expired or already used.',
};

type RoleName = Partial<Record<Locale, string>>;

interface RoleRow {
  id: string;
  code: string;
  name: RoleName;
  organizationType: string;
  organizationId: string | null;
  permissions: Array<{ permissionCode: string }>;
}

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface InviteInput {
  email: string;
  roleCode: string;
}

export interface AcceptNewInput {
  token: string;
  firstName: string;
  lastName: string;
  password: string;
  locale?: Locale;
}

export interface MemberUpdateInput {
  roleCode?: string;
  status?: 'ACTIVE' | 'DISABLED';
}

const roleLabel = (name: RoleName, locale: Locale) => name[locale] ?? name.fr ?? '';

/**
 * Team management inside one organization: invitations (by email, with one role), accepting
 * them, changing a member's role and enabling or disabling members.
 *
 * Two guard rails: nobody can grant a role carrying permissions they do not hold themselves
 * (no privilege escalation), and the last member able to manage the team cannot be removed
 * or downgraded (no orphaned organization).
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  /** Roles that can be assigned in this organization: system roles of its type plus its custom roles. */
  async assignableRoles(tenant: TenantInfo) {
    const roles = (await this.prisma.forTenant(tenant, (tx) =>
      tx.role.findMany({
        where: this.roleScope(tenant),
        include: { permissions: { select: { permissionCode: true } } },
        orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
      }),
    )) as RoleRow[];
    return roles.map((r) => ({
      code: r.code,
      name: r.name,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
      assignableByYou: this.canGrant(tenant, r),
    }));
  }

  async listInvitations(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.invitation.findMany({
        where: {
          organizationId: tenant.organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          email: true,
          expiresAt: true,
          createdAt: true,
          role: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async invite(
    tenant: TenantInfo,
    input: InviteInput,
    meta: RequestMeta,
  ): Promise<{ id: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const secret = newSecret();
    const invitationId = uuidv7();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

    const ctx = await this.prisma.forTenant(tenant, async (tx) => {
      const role = await this.findRole(tx, tenant, input.roleCode);
      this.assertCanGrant(tenant, role);

      const existingUser = (await tx.user.findUnique({ where: { email } })) as {
        id: string;
      } | null;
      if (existingUser) {
        const member = await tx.organizationMember.findFirst({
          where: {
            organizationId: tenant.organizationId,
            userId: existingUser.id,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (member)
          throw new ConflictException({
            code: 'ALREADY_MEMBER',
            message: 'This person is already a member.',
          });
      }

      // Only the latest invitation for an email stays valid.
      await tx.invitation.updateMany({
        where: { organizationId: tenant.organizationId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.invitation.create({
        data: {
          id: invitationId,
          organizationId: tenant.organizationId,
          email,
          roleId: role.id,
          tokenHash: sha256(secret),
          invitedById: tenant.userId,
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'member.invited',
        entityType: 'Invitation',
        entityId: invitationId,
        diff: { email, role: role.code },
        meta,
      });

      const org = (await tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { legalName: true, defaultLocale: true },
      })) as { legalName: string; defaultLocale: Locale };
      const inviter = (await tx.user.findUnique({
        where: { id: tenant.userId },
        select: { firstName: true, lastName: true },
      })) as { firstName: string; lastName: string };
      return { role, org, inviter };
    });

    const locale = ctx.org.defaultLocale;
    this.deliver(
      buildMail({
        locale,
        to: email,
        name: '',
        key: 'email.invite',
        vars: {
          organization: ctx.org.legalName,
          inviter: `${ctx.inviter.firstName} ${ctx.inviter.lastName}`,
          role: roleLabel(ctx.role.name, locale),
          days: INVITATION_TTL_DAYS,
        },
        actionUrl: this.link(
          '/accept-invitation',
          formatInvitationToken(tenant.organizationId, invitationId, secret),
        ),
      }),
    );
    return { id: invitationId, expiresAt };
  }

  async revokeInvitation(
    tenant: TenantInfo,
    invitationId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.prisma.forTenant(tenant, async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: {
          id: invitationId,
          organizationId: tenant.organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (count === 0)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found.' });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'member.invitation_revoked',
        entityType: 'Invitation',
        entityId: invitationId,
        meta,
      });
    });
  }

  /** What the invitee sees before accepting. Public: the token is the credential. */
  async preview(rawToken: string) {
    const parsed = parseInvitationToken(rawToken);
    if (!parsed) throw new BadRequestException(INVALID_INVITATION);

    return this.prisma.forTenant(
      { organizationId: parsed.organizationId, userId: null },
      async (tx) => {
        const { invitation, role } = await this.loadValidInvitation(tx, parsed);
        const org = (await tx.organization.findUnique({
          where: { id: parsed.organizationId },
          select: { legalName: true, type: true },
        })) as { legalName: string; type: string };
        const existing = await tx.user.findUnique({
          where: { email: invitation.email },
          select: { id: true },
        });
        return {
          organizationName: org.legalName,
          organizationType: org.type,
          email: invitation.email,
          role: { code: role.code, name: role.name },
          expiresAt: invitation.expiresAt,
          existingAccount: existing !== null,
        };
      },
    );
  }

  /** Invitee without an account: creates it (email already proven by the link) and joins. */
  async acceptAsNewUser(input: AcceptNewInput, meta: RequestMeta): Promise<IssuedTokens> {
    const parsed = parseInvitationToken(input.token);
    if (!parsed) throw new BadRequestException(INVALID_INVITATION);
    const userId = uuidv7();
    const passwordHash = await hashPassword(input.password);

    await this.prisma.forTenant({ organizationId: parsed.organizationId, userId }, async (tx) => {
      const { invitation, role } = await this.loadValidInvitation(tx, parsed);
      if (await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } })) {
        throw new ConflictException({
          code: 'ACCOUNT_EXISTS',
          message: 'An account already exists for this email. Sign in to accept the invitation.',
        });
      }
      await tx.user.create({
        data: {
          id: userId,
          email: invitation.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale ?? 'fr',
          emailVerifiedAt: new Date(),
        },
      });
      await this.joinOrganization(tx, invitation, role, userId, meta);
    });

    return this.auth.issueSession(userId, meta);
  }

  /** Signed-in invitee: the invitation must be addressed to their email. */
  async acceptAsExistingUser(
    rawToken: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<{ organizationId: string }> {
    const parsed = parseInvitationToken(rawToken);
    if (!parsed) throw new BadRequestException(INVALID_INVITATION);

    await this.prisma.forTenant({ organizationId: parsed.organizationId, userId }, async (tx) => {
      const { invitation, role } = await this.loadValidInvitation(tx, parsed);
      const user = (await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      })) as { email: string } | null;
      if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new ForbiddenException({
          code: 'INVITATION_EMAIL_MISMATCH',
          message: 'This invitation was sent to a different email address.',
        });
      }
      await this.joinOrganization(tx, invitation, role, userId, meta);
    });
    return { organizationId: parsed.organizationId };
  }

  async updateMember(
    tenant: TenantInfo,
    memberId: string,
    input: MemberUpdateInput,
    meta: RequestMeta,
  ) {
    if (!input.roleCode && !input.status) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'Provide roleCode or status.',
      });
    }

    return this.prisma.forTenant(tenant, async (tx) => {
      const member = (await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: tenant.organizationId, deletedAt: null },
        include: {
          roles: {
            include: { role: { include: { permissions: { select: { permissionCode: true } } } } },
          },
        },
      })) as {
        id: string;
        userId: string;
        status: string;
        roles: Array<{ role: RoleRow }>;
      } | null;
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });
      if (member.userId === tenant.userId) {
        throw new BadRequestException({
          code: 'CANNOT_MODIFY_SELF',
          message: 'You cannot change your own role or status.',
        });
      }

      // Changing someone who holds more power than you is also an escalation.
      for (const r of member.roles) this.assertCanGrant(tenant, r.role);

      const currentlyManages = member.roles.some((r) =>
        r.role.permissions.some((p) => p.permissionCode === MANAGE_PERMISSION),
      );
      let newRole: RoleRow | null = null;
      if (input.roleCode) {
        newRole = await this.findRole(tx, tenant, input.roleCode);
        this.assertCanGrant(tenant, newRole);
      }
      const willManage =
        (input.status ?? member.status) === 'ACTIVE' &&
        (newRole
          ? newRole.permissions.some((p) => p.permissionCode === MANAGE_PERMISSION)
          : currentlyManages);

      if (currentlyManages && member.status === 'ACTIVE' && !willManage) {
        const managers = await tx.organizationMember.count({
          where: {
            organizationId: tenant.organizationId,
            status: 'ACTIVE',
            deletedAt: null,
            roles: {
              some: { role: { permissions: { some: { permissionCode: MANAGE_PERMISSION } } } },
            },
          },
        });
        if (managers <= 1) {
          throw new ConflictException({
            code: 'LAST_ADMIN',
            message: 'The organization must keep at least one administrator.',
          });
        }
      }

      if (newRole) {
        await tx.memberRole.deleteMany({ where: { memberId: member.id } });
        await tx.memberRole.create({
          data: { memberId: member.id, roleId: newRole.id, organizationId: tenant.organizationId },
        });
      }
      if (input.status) {
        await tx.organizationMember.update({
          where: { id: member.id },
          data: { status: input.status },
        });
      }

      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'member.updated',
        entityType: 'OrganizationMember',
        entityId: member.id,
        diff: {
          before: { roles: member.roles.map((r) => r.role.code), status: member.status },
          after: { role: newRole?.code, status: input.status },
        },
        meta,
      });
      return {
        id: member.id,
        role: newRole?.code ?? member.roles[0]?.role.code ?? null,
        status: input.status ?? member.status,
      };
    });
  }

  // ---------------------------------------------------------------------------

  private roleScope(tenant: TenantInfo) {
    return {
      OR: [
        { organizationId: null, organizationType: tenant.organizationType },
        { organizationId: tenant.organizationId },
      ],
    };
  }

  private async findRole(tx: TenantTx, tenant: TenantInfo, code: string): Promise<RoleRow> {
    const role = (await tx.role.findFirst({
      where: { code, ...this.roleScope(tenant) },
      include: { permissions: { select: { permissionCode: true } } },
    })) as RoleRow | null;
    if (!role)
      throw new BadRequestException({
        code: 'UNKNOWN_ROLE',
        message: 'This role does not exist for your organization.',
      });
    return role;
  }

  private canGrant(tenant: TenantInfo, role: RoleRow): boolean {
    return role.permissions.every((p) => tenant.permissions.has(p.permissionCode));
  }

  private assertCanGrant(tenant: TenantInfo, role: RoleRow): void {
    if (!this.canGrant(tenant, role)) {
      throw new ForbiddenException({
        code: 'ROLE_EXCEEDS_YOUR_PERMISSIONS',
        message: 'You cannot assign a role with more permissions than your own.',
      });
    }
  }

  private async loadValidInvitation(
    tx: TenantTx,
    parsed: { organizationId: string; invitationId: string; secret: string },
  ): Promise<{ invitation: InvitationRow; role: RoleRow }> {
    const invitation = (await tx.invitation.findFirst({
      where: { id: parsed.invitationId, organizationId: parsed.organizationId },
    })) as InvitationRow | null;
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      !digestEquals(invitation.tokenHash, sha256(parsed.secret))
    ) {
      throw new BadRequestException(INVALID_INVITATION);
    }
    const org = (await tx.organization.findUnique({
      where: { id: parsed.organizationId },
      select: { status: true, deletedAt: true },
    })) as { status: string; deletedAt: Date | null } | null;
    if (!org || org.deletedAt || org.status === 'SUSPENDED' || org.status === 'REJECTED') {
      throw new BadRequestException(INVALID_INVITATION);
    }
    const role = (await tx.role.findUnique({
      where: { id: invitation.roleId },
      include: { permissions: { select: { permissionCode: true } } },
    })) as RoleRow;
    return { invitation, role };
  }

  /** Creates or reactivates the membership with the invited role and closes the invitation. */
  private async joinOrganization(
    tx: TenantTx,
    invitation: InvitationRow,
    role: RoleRow,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const existing = (await tx.organizationMember.findFirst({
      where: { organizationId: invitation.organizationId, userId },
    })) as { id: string } | null;

    const memberId = existing?.id ?? uuidv7();
    if (existing) {
      await tx.organizationMember.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', deletedAt: null },
      });
      await tx.memberRole.deleteMany({ where: { memberId } });
    } else {
      await tx.organizationMember.create({
        data: { id: memberId, organizationId: invitation.organizationId, userId },
      });
    }
    await tx.memberRole.create({
      data: { memberId, roleId: role.id, organizationId: invitation.organizationId },
    });

    // Conditional update: two simultaneous accepts cannot both succeed.
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (count !== 1) throw new BadRequestException(INVALID_INVITATION);

    await this.audit.record(tx, {
      organizationId: invitation.organizationId,
      actorUserId: userId,
      action: 'member.invitation_accepted',
      entityType: 'Invitation',
      entityId: invitation.id,
      diff: { role: role.code },
      meta,
    });
  }

  private link(path: string, token: string): string {
    const base = (this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  private deliver(mail: Parameters<Mailer['send']>[0]): void {
    this.mailer.send(mail).catch((err: unknown) => {
      this.logger.error(
        `Failed to send "${mail.subject}": ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
