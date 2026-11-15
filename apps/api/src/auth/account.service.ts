import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantTx } from '@tasheel/db';
import type { Locale } from '@tasheel/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-context';
import { Mailer, type OutgoingMail } from '../mail/mailer';
import { buildMail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password';
import { formatUserToken, newSecret, parseUserToken, sha256 } from './tokens';

export const EMAIL_VERIFICATION_TTL_HOURS = 48;
export const PASSWORD_RESET_TTL_MINUTES = 30;

type Purpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

interface TokenRow {
  id: string;
  userId: string;
  purpose: Purpose;
  expiresAt: Date;
  usedAt: Date | null;
}

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  locale: Locale;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
}

const INVALID_TOKEN = { code: 'INVALID_TOKEN', message: 'This link is invalid or has expired.' };

/**
 * Email verification and password reset. Emails are sent after the database transaction
 * commits and are not awaited by the HTTP response: a slow or failing mail server never
 * blocks the user, and response time does not reveal whether an account exists.
 * (Phase 6 moves sending to a BullMQ queue with retries.)
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  async sendEmailVerification(
    userId: string,
    meta?: RequestMeta,
  ): Promise<'sent' | 'already_verified'> {
    const result = await this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      const user = (await tx.user.findUnique({ where: { id: userId } })) as UserRow | null;
      if (!user || user.deletedAt)
        throw new UnauthorizedException({
          code: 'INVALID_SESSION',
          message: 'Please sign in again.',
        });
      if (user.emailVerifiedAt) return null;

      const token = await this.createToken(
        tx,
        userId,
        'EMAIL_VERIFICATION',
        EMAIL_VERIFICATION_TTL_HOURS * 3_600_000,
      );
      await this.audit.record(tx, {
        organizationId: null,
        actorUserId: userId,
        action: 'auth.email_verification_sent',
        entityType: 'User',
        entityId: userId,
        meta,
      });
      return { user, token };
    });

    if (!result) return 'already_verified';
    this.deliver(
      buildMail({
        locale: result.user.locale,
        to: result.user.email,
        name: result.user.firstName,
        key: 'email.verify',
        vars: { hours: EMAIL_VERIFICATION_TTL_HOURS },
        actionUrl: this.link('/verify-email', result.token),
      }),
    );
    return 'sent';
  }

  async confirmEmail(rawToken: string, meta: RequestMeta): Promise<void> {
    const parsed = parseUserToken(rawToken);
    if (!parsed) throw new BadRequestException(INVALID_TOKEN);
    const now = new Date();

    const ok = await this.prisma.forTenant(
      { organizationId: null, userId: parsed.userId },
      async (tx) => {
        const token = await this.findUsableToken(
          tx,
          parsed.userId,
          parsed.secret,
          'EMAIL_VERIFICATION',
          now,
        );
        if (!token) return false;

        await tx.userToken.update({ where: { id: token.id }, data: { usedAt: now } });
        await tx.user.update({ where: { id: parsed.userId }, data: { emailVerifiedAt: now } });
        await this.audit.record(tx, {
          organizationId: null,
          actorUserId: parsed.userId,
          action: 'auth.email_verified',
          entityType: 'User',
          entityId: parsed.userId,
          meta,
        });
        return true;
      },
    );

    if (!ok) throw new BadRequestException(INVALID_TOKEN);
  }

  /** Silently does nothing for unknown emails. The controller never awaits this. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    // users is global (no RLS): lookup by email needs no tenant context.
    const user = (await this.prisma.user.findUnique({ where: { email } })) as UserRow | null;
    if (!user || user.deletedAt) return;

    const token = await this.prisma.forTenant(
      { organizationId: null, userId: user.id },
      async (tx) => {
        const raw = await this.createToken(
          tx,
          user.id,
          'PASSWORD_RESET',
          PASSWORD_RESET_TTL_MINUTES * 60_000,
        );
        await this.audit.record(tx, {
          organizationId: null,
          actorUserId: user.id,
          action: 'auth.password_reset_requested',
          entityType: 'User',
          entityId: user.id,
          meta,
        });
        return raw;
      },
    );

    this.deliver(
      buildMail({
        locale: user.locale,
        to: user.email,
        name: user.firstName,
        key: 'email.reset',
        vars: { minutes: PASSWORD_RESET_TTL_MINUTES },
        actionUrl: this.link('/reset-password', token),
      }),
    );
  }

  /**
   * Sets the new password, burns every outstanding reset link, clears any lockout and signs
   * the user out everywhere. Using the link also proves ownership of the mailbox.
   */
  async resetPassword(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const parsed = parseUserToken(rawToken);
    if (!parsed) throw new BadRequestException(INVALID_TOKEN);
    const now = new Date();
    const passwordHash = await hashPassword(newPassword);

    const user = await this.prisma.forTenant(
      { organizationId: null, userId: parsed.userId },
      async (tx) => {
        const token = await this.findUsableToken(
          tx,
          parsed.userId,
          parsed.secret,
          'PASSWORD_RESET',
          now,
        );
        if (!token) return null;

        await tx.userToken.updateMany({
          where: { userId: parsed.userId, purpose: 'PASSWORD_RESET', usedAt: null },
          data: { usedAt: now },
        });
        const existing = (await tx.user.findUnique({
          where: { id: parsed.userId },
        })) as UserRow | null;
        if (!existing || existing.deletedAt) return null;

        const updated = (await tx.user.update({
          where: { id: parsed.userId },
          data: {
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            ...(existing.emailVerifiedAt ? {} : { emailVerifiedAt: now }),
          },
        })) as UserRow;
        await tx.session.updateMany({
          where: { userId: parsed.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.audit.record(tx, {
          organizationId: null,
          actorUserId: parsed.userId,
          action: 'auth.password_reset_completed',
          entityType: 'User',
          entityId: parsed.userId,
          meta,
        });
        return updated;
      },
    );

    if (!user) throw new BadRequestException(INVALID_TOKEN);
    this.deliver(
      buildMail({
        locale: user.locale,
        to: user.email,
        name: user.firstName,
        key: 'email.passwordChanged',
      }),
    );
  }

  /** Invalidates earlier unused tokens of the same purpose, so only the latest link works. */
  private async createToken(
    tx: TenantTx,
    userId: string,
    purpose: Purpose,
    ttlMs: number,
  ): Promise<string> {
    const now = new Date();
    await tx.userToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    const secret = newSecret();
    await tx.userToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(secret),
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    });
    return formatUserToken(userId, secret);
  }

  private async findUsableToken(
    tx: TenantTx,
    userId: string,
    secret: string,
    purpose: Purpose,
    now: Date,
  ): Promise<TokenRow | null> {
    const token = (await tx.userToken.findUnique({
      where: { tokenHash: sha256(secret) },
    })) as TokenRow | null;
    if (
      !token ||
      token.userId !== userId ||
      token.purpose !== purpose ||
      token.usedAt ||
      token.expiresAt <= now
    ) {
      return null;
    }
    return token;
  }

  private link(path: string, token: string): string {
    const base = (this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  private deliver(mail: OutgoingMail): void {
    this.mailer.send(mail).catch((err: unknown) => {
      this.logger.error(
        `Failed to send "${mail.subject}": ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
