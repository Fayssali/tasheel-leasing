import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantContext, TenantTx } from '@tasheel/db';
import type { Locale } from '@tasheel/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from './mailer';
import { buildMail } from './templates';

type MailKey = Parameters<typeof buildMail>[0]['key'];
export interface Recipient {
  id: string;
  email: string;
  firstName: string;
  locale: Locale;
}

/**
 * Tells people about an event: an email in their own language and an in-app notification.
 * Lookups and notification writes run in the recipient organization's context on the server's
 * authority; nothing from them is returned to the caller. Fire-and-forget; failures are logged.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger(Notifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  async membersWith(organizationId: string, permission: string): Promise<Recipient[]> {
    const ctx: TenantContext = { organizationId, userId: null };
    const rows = (await this.prisma.forTenant(ctx, (tx: TenantTx) =>
      tx.organizationMember.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { permissions: { some: { permissionCode: permission } } } } },
        },
        select: { user: { select: { id: true, email: true, firstName: true, locale: true } } },
      }),
    )) as Array<{ user: Recipient }>;
    return rows.map((r) => r.user);
  }

  async user(id: string): Promise<Recipient | null> {
    return (await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, locale: true },
    })) as Recipient | null;
  }

  /**
   * Sends to the given recipients of one organization. vars may depend on each recipient's
   * language (a localized title or amount); the in-app notification keeps those values.
   */
  async send(
    organizationId: string,
    recipients: Recipient[],
    key: MailKey,
    vars: (locale: Locale) => Record<string, string | number>,
    path: string,
  ): Promise<void> {
    for (const r of recipients) {
      const mail = buildMail({
        locale: r.locale,
        to: r.email,
        name: r.firstName,
        key,
        vars: vars(r.locale),
        actionUrl: this.link(path),
      });
      this.mailer.send(mail).catch((err: unknown) => {
        this.logger.error(
          `Failed to send "${mail.subject}": ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    if (!recipients.length) return;
    try {
      // createMany: a plain INSERT. The rows are not readable in this system context (no user),
      // and INSERT ... RETURNING would be checked against the SELECT policy.
      await this.prisma.forTenant({ organizationId, userId: null }, (tx: TenantTx) =>
        tx.notification.createMany({
          data: recipients.map((r) => ({
            userId: r.id,
            organizationId,
            key,
            vars: vars(r.locale),
            link: path,
          })),
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to record notifications: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Everyone in an organization holding a permission. */
  async notifyOrg(
    organizationId: string,
    permission: string,
    key: MailKey,
    vars: (locale: Locale) => Record<string, string | number>,
    path: string,
  ): Promise<void> {
    try {
      await this.send(
        organizationId,
        await this.membersWith(organizationId, permission),
        key,
        vars,
        path,
      );
    } catch (err) {
      this.logger.error(
        `Recipient lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** One person, as a member of the given organization. */
  async notifyUser(
    userId: string,
    organizationId: string,
    key: MailKey,
    vars: (locale: Locale) => Record<string, string | number>,
    path: string,
  ): Promise<void> {
    try {
      const user = await this.user(userId);
      if (user) await this.send(organizationId, [user], key, vars, path);
    } catch (err) {
      this.logger.error(`Notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private link(path: string): string {
    return `${(this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')}${path}`;
  }
}
