import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantContext, TenantTx } from '@tasheel/db';
import type { Locale } from '@tasheel/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from './mailer';
import { buildMail } from './templates';

type MailKey = Parameters<typeof buildMail>[0]['key'];
export interface Recipient {
  email: string;
  firstName: string;
  locale: Locale;
}

/**
 * Emails the active members of an organization who hold a permission, each in their own
 * language. Lookups run in that organization's context on the server's authority and nothing
 * from them is returned to the caller. Sending is fire-and-forget; failures are logged.
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
        select: { user: { select: { email: true, firstName: true, locale: true } } },
      }),
    )) as Array<{ user: Recipient }>;
    return rows.map((r) => r.user);
  }

  async user(id: string): Promise<Recipient | null> {
    return (await this.prisma.user.findUnique({
      where: { id },
      select: { email: true, firstName: true, locale: true },
    })) as Recipient | null;
  }

  /** vars may depend on the recipient's language (e.g. a localized title or amount). */
  send(
    recipients: Recipient[],
    key: MailKey,
    vars: (locale: Locale) => Record<string, string | number>,
    path: string,
  ): void {
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
  }

  async notifyOrg(
    organizationId: string,
    permission: string,
    key: MailKey,
    vars: (locale: Locale) => Record<string, string | number>,
    path: string,
  ): Promise<void> {
    try {
      this.send(await this.membersWith(organizationId, permission), key, vars, path);
    } catch (err) {
      this.logger.error(
        `Recipient lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private link(path: string): string {
    return `${(this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')}${path}`;
  }
}
