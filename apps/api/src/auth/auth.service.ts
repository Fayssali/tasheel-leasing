import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ADMIN_ROLE_BY_TYPE,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { isLocked, lockUntilAfterFailure } from './lockout';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { digestEquals, formatRefreshToken, newSecret, parseRefreshToken, sha256 } from './tokens';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface MembershipView {
  organizationId: string;
  legalName: string;
  type: string;
  status: string;
  roles: Array<{ code: string; name: unknown }>;
}

export interface MeView {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    locale: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
  memberships: MembershipView[];
}

/** One message for every login failure, so responses never reveal whether an email exists. */
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' };
const INVALID_SESSION = {
  code: 'INVALID_SESSION',
  message: 'Session expired. Please sign in again.',
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates the organization (PENDING_VERIFICATION), its first administrator and the
   * membership, in one transaction. The organization id is generated here so it can be
   * set as the RLS tenant context before the insert.
   */
  async register(dto: RegisterDto, meta: RequestMeta): Promise<IssuedTokens> {
    const userId = uuidv7();
    const organizationId = uuidv7();
    const passwordHash = await hashPassword(dto.password);
    const adminRoleCode = ADMIN_ROLE_BY_TYPE[dto.organizationType];

    try {
      await this.prisma.forTenant({ organizationId, userId }, async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone ?? null,
            locale: dto.locale ?? 'fr',
          },
        });

        await tx.organization.create({
          data: {
            id: organizationId,
            type: dto.organizationType,
            legalName: dto.legalName,
            tradeName: dto.tradeName ?? null,
            rcNumber: dto.rcNumber ?? null,
            nif: dto.nif ?? null,
            nis: dto.nis ?? null,
            wilayaCode: dto.wilayaCode ?? null,
            email: dto.email,
            phone: dto.phone ?? null,
            defaultLocale: dto.locale ?? 'fr',
          },
        });

        const role = await tx.role.findFirst({
          where: { organizationId: null, code: adminRoleCode },
        });
        if (!role) {
          throw new InternalServerErrorException('System roles are missing: run the seed.');
        }

        const member = await tx.organizationMember.create({ data: { organizationId, userId } });
        await tx.memberRole.create({
          data: { memberId: member.id, roleId: role.id, organizationId },
        });

        await this.audit.record(tx, {
          organizationId,
          actorUserId: userId,
          action: 'auth.registered',
          entityType: 'Organization',
          entityId: organizationId,
          diff: {
            organizationType: dto.organizationType,
            legalName: dto.legalName,
            email: dto.email,
          },
          meta,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'An account already exists for this email.',
        });
      }
      throw err;
    }

    return this.issueSession(userId, meta);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedTokens> {
    const now = new Date();
    // users is a global table (no RLS): lookup by email needs no tenant context.
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.deletedAt) {
      await burnPasswordCheck(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (isLocked(user.lockedUntil, now)) {
      await this.recordAuthEvent(user.id, 'auth.login_blocked_locked', meta);
      // Same message as a wrong password: do not confirm that the account exists.
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      const failedLoginCount = user.failedLoginCount + 1;
      const lockedUntil = lockUntilAfterFailure(failedLoginCount, now);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount, ...(lockedUntil ? { lockedUntil } : {}) },
      });
      await this.recordAuthEvent(
        user.id,
        lockedUntil ? 'auth.account_locked' : 'auth.login_failed',
        meta,
        {
          failedLoginCount,
        },
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await this.recordAuthEvent(user.id, 'auth.login_succeeded', meta);
    return this.issueSession(user.id, meta);
  }

  /**
   * Rotates the refresh token. Presenting an already-rotated token means it was copied:
   * the whole session is revoked (refresh-token reuse detection).
   */
  async refresh(rawToken: unknown, meta: RequestMeta): Promise<IssuedTokens> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) throw new UnauthorizedException(INVALID_SESSION);

    const now = new Date();
    const secret = newSecret();

    const outcome = await this.prisma.forTenant(
      { organizationId: null, userId: parsed.userId },
      async (tx) => {
        const session = await tx.session.findUnique({ where: { id: parsed.sessionId } });
        if (
          !session ||
          session.userId !== parsed.userId ||
          session.revokedAt ||
          session.expiresAt <= now
        ) {
          return 'invalid' as const;
        }

        if (!digestEquals(session.refreshTokenHash, sha256(parsed.secret))) {
          await tx.session.update({ where: { id: session.id }, data: { revokedAt: now } });
          await this.audit.record(tx, {
            organizationId: null,
            actorUserId: parsed.userId,
            action: 'auth.refresh_reuse_detected',
            entityType: 'Session',
            entityId: session.id,
            meta,
          });
          return 'reused' as const;
        }

        const user = await tx.user.findUnique({ where: { id: parsed.userId } });
        if (!user || user.deletedAt || isLocked(user.lockedUntil, now)) return 'invalid' as const;

        await tx.session.update({
          where: { id: session.id },
          data: {
            refreshTokenHash: sha256(secret),
            userAgent: meta.userAgent,
            ipAddress: meta.ipAddress,
          },
        });
        return { sessionId: session.id, expiresAt: session.expiresAt };
      },
    );

    // Thrown outside the transaction so the revocation above is committed.
    if (outcome === 'invalid' || outcome === 'reused')
      throw new UnauthorizedException(INVALID_SESSION);

    return {
      accessToken: await this.signAccessToken(parsed.userId, outcome.sessionId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: formatRefreshToken(parsed.userId, outcome.sessionId, secret),
      refreshExpiresAt: outcome.expiresAt,
    };
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actorUserId: userId,
        action: 'auth.logged_out',
        entityType: 'Session',
        entityId: sessionId,
        meta,
      });
    });
  }

  /** Profile plus every organization the user can switch to. */
  async me(userId: string): Promise<MeView> {
    return this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt) throw new UnauthorizedException(INVALID_SESSION);

      const members = await tx.organizationMember.findMany({
        where: { userId, status: 'ACTIVE', deletedAt: null },
        include: {
          organization: {
            select: { id: true, legalName: true, type: true, status: true, deletedAt: true },
          },
          roles: { include: { role: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          locale: user.locale,
          emailVerified: user.emailVerifiedAt !== null,
          mfaEnabled: user.mfaEnabled,
        },
        memberships: members
          .filter((m: { organization: { deletedAt: Date | null } }) => !m.organization.deletedAt)
          .map(
            (m: {
              organization: { id: string; legalName: string; type: string; status: string };
              roles: Array<{ role: { code: string; name: unknown } }>;
            }) => ({
              organizationId: m.organization.id,
              legalName: m.organization.legalName,
              type: m.organization.type,
              status: m.organization.status,
              roles: m.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
            }),
          ),
      };
    });
  }

  private async issueSession(userId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const sessionId = uuidv7();
    const secret = newSecret();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.prisma.forTenant({ organizationId: null, userId }, (tx) =>
      tx.session.create({
        data: {
          id: sessionId,
          userId,
          refreshTokenHash: sha256(secret),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
          expiresAt: refreshExpiresAt,
        },
      }),
    );

    return {
      accessToken: await this.signAccessToken(userId, sessionId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: formatRefreshToken(userId, sessionId, secret),
      refreshExpiresAt,
    };
  }

  private signAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  private async recordAuthEvent(
    userId: string,
    action: string,
    meta: RequestMeta,
    diff?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.forTenant({ organizationId: null, userId }, (tx) =>
      this.audit.record(tx, {
        organizationId: null,
        actorUserId: userId,
        action,
        entityType: 'User',
        entityId: userId,
        diff,
        meta,
      }),
    );
  }
}
