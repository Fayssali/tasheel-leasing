import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MFA_REQUIRED_ORG_TYPES, type OrganizationType } from '@tasheel/shared';
import { AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPassword } from '../password';
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from './recovery-codes';
import { open, parseKey, seal } from './secret-box';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

interface MfaUser {
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaPendingSecret: string | null;
  mfaRecoveryCodes: string[];
  mfaLastUsedStep: number | null;
  deletedAt: Date | null;
}

export type MfaMethod = 'totp' | 'recovery';

const INVALID_CODE = {
  code: 'INVALID_MFA_CODE',
  message: 'The code is invalid or has already been used.',
};
const WRONG_PASSWORD = {
  code: 'PASSWORD_INCORRECT',
  message: 'Your current password is incorrect.',
};

/**
 * TOTP two-factor authentication: enrolment, verification with replay protection,
 * recovery codes, and the policy that makes it mandatory for some organization types.
 * `users` is a global table (no RLS), so user reads and writes need no tenant context;
 * audit entries still go through forTenant.
 */
@Injectable()
export class MfaService {
  private key?: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Step 1: re-authenticate with the password, receive a secret to add to an authenticator app. */
  async startSetup(
    userId: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.loadUser(userId);
    if (user.mfaEnabled)
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'Two-factor authentication is already enabled.',
      });
    if (!(await verifyPassword(user.passwordHash, password)))
      throw new ForbiddenException(WRONG_PASSWORD);

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecret: seal(secret, this.encryptionKey()) },
    });
    await this.recordEvent(userId, 'auth.mfa_setup_started', meta);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /**
   * Step 2: prove the app works by entering a code. Enables MFA, returns recovery codes
   * (shown once), and signs out every other session.
   */
  async confirmSetup(
    userId: string,
    currentSessionId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    const user = await this.loadUser(userId);
    if (user.mfaEnabled)
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'Two-factor authentication is already enabled.',
      });
    if (!user.mfaPendingSecret) {
      throw new BadRequestException({
        code: 'MFA_SETUP_NOT_STARTED',
        message: 'Start the setup first.',
      });
    }

    const step = verifyTotp(
      open(user.mfaPendingSecret, this.encryptionKey()),
      code,
      new Date(),
      null,
    );
    if (step === null) throw new BadRequestException(INVALID_CODE);

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecret: user.mfaPendingSecret,
          mfaPendingSecret: null,
          mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
          mfaLastUsedStep: step,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null, NOT: { id: currentSessionId } },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actorUserId: userId,
        action: 'auth.mfa_enabled',
        entityType: 'User',
        entityId: userId,
        meta,
      });
    });
    return recoveryCodes;
  }

  async disable(userId: string, password: string, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.loadUser(userId);
    if (!user.mfaEnabled)
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Two-factor authentication is not enabled.',
      });
    if (await this.isRequiredFor(userId)) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_BY_POLICY',
        message: 'Two-factor authentication is mandatory for your organization.',
      });
    }
    if (!(await verifyPassword(user.passwordHash, password)))
      throw new ForbiddenException(WRONG_PASSWORD);
    if (!(await this.consumeCode(userId, code))) throw new BadRequestException(INVALID_CODE);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaPendingSecret: null,
        mfaRecoveryCodes: [],
        mfaLastUsedStep: null,
      },
    });
    await this.recordEvent(userId, 'auth.mfa_disabled', meta);
  }

  async regenerateRecoveryCodes(
    userId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    const user = await this.loadUser(userId);
    if (!user.mfaEnabled)
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Two-factor authentication is not enabled.',
      });
    if (!(await this.consumeCode(userId, code))) throw new BadRequestException(INVALID_CODE);

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
    });
    await this.recordEvent(userId, 'auth.mfa_recovery_codes_regenerated', meta);
    return recoveryCodes;
  }

  /**
   * Verifies and consumes a TOTP code or a recovery code. Each consumption is a single
   * conditional UPDATE, so two concurrent requests with the same code cannot both succeed.
   */
  async consumeCode(userId: string, code: string): Promise<MfaMethod | null> {
    const user = await this.loadUser(userId);
    if (!user.mfaEnabled || !user.mfaSecret) return null;

    if (looksLikeRecoveryCode(code)) {
      const hash = hashRecoveryCode(code);
      const updated = await this.prisma.$executeRaw`
        UPDATE users SET mfa_recovery_codes = array_remove(mfa_recovery_codes, ${hash}), updated_at = now()
        WHERE id = ${userId}::uuid AND ${hash} = ANY(mfa_recovery_codes)`;
      return updated === 1 ? 'recovery' : null;
    }

    const step = verifyTotp(
      open(user.mfaSecret, this.encryptionKey()),
      code,
      new Date(),
      user.mfaLastUsedStep,
    );
    if (step === null) return null;
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    });
    return count === 1 ? 'totp' : null;
  }

  /** True when the user belongs to at least one organization whose type mandates MFA. */
  async isRequiredFor(userId: string): Promise<boolean> {
    const memberships = (await this.prisma.forTenant({ organizationId: null, userId }, (tx) =>
      tx.organizationMember.findMany({
        where: { userId, status: 'ACTIVE', deletedAt: null },
        select: { organization: { select: { type: true } } },
      }),
    )) as Array<{ organization: { type: OrganizationType } }>;
    return memberships.some((m) => MFA_REQUIRED_ORG_TYPES.includes(m.organization.type));
  }

  private async loadUser(userId: string): Promise<MfaUser> {
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) as MfaUser | null;
    if (!user || user.deletedAt)
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'Please sign in again.',
      });
    return user;
  }

  private encryptionKey(): Buffer {
    this.key ??= parseKey(this.config.get<string>('MFA_ENCRYPTION_KEY'));
    return this.key;
  }

  private async recordEvent(userId: string, action: string, meta: RequestMeta): Promise<void> {
    await this.prisma.forTenant({ organizationId: null, userId }, (tx) =>
      this.audit.record(tx, {
        organizationId: null,
        actorUserId: userId,
        action,
        entityType: 'User',
        entityId: userId,
        meta,
      }),
    );
  }
}
