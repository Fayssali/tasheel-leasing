import { ConfigService } from '@nestjs/config';
import { Notifier } from '../src/mail/notifier';
import { NotificationsService } from '../src/notifications/notifications.module';
import { ReportsService } from '../src/reports/reports.module';
import type { TenantInfo } from '../src/common/request-context';

describe('notifier', () => {
  it('sends each email in the recipient’s language and records one in-app notification per recipient', async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const recorded: Array<{ ctx: unknown; data: unknown }> = [];
    const tx = {
      notification: {
        createMany: async ({ data }: { data: unknown }) => void recorded.push({ ctx: null, data }),
      },
    };
    const prisma = {
      forTenant: async (ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => {
        const r = await fn(tx);
        recorded[recorded.length - 1]!.ctx = ctx;
        return r;
      },
    };
    const notifier = new Notifier(
      prisma as never,
      { send: async (m: { to: string; subject: string }) => void sent.push(m) } as never,
      new ConfigService({}),
    );
    await notifier.send(
      'org-1',
      [
        { id: 'u1', email: 'a@x.dz', firstName: 'Amina', locale: 'fr' },
        { id: 'u2', email: 'b@x.dz', firstName: 'Bilal', locale: 'ar' },
      ],
      'email.invoiceIssued',
      (locale) => ({
        number: 'TSL-2026-000001',
        total: locale === 'ar' ? '١٠٠ دج' : '100 DZD',
        dueDate: '15/12/2026',
      }),
      '/app/billing',
    );
    expect(sent.map((m) => m.subject)).toEqual([
      'Facture TSL-2026-000001 — Tasheel Leasing',
      'الفاتورة TSL-2026-000001 — تسهيل ليزينغ',
    ]);
    // Written in the recipient organization's context (no user), as a plain insert.
    expect(recorded).toEqual([
      {
        ctx: { organizationId: 'org-1', userId: null },
        data: [
          {
            userId: 'u1',
            organizationId: 'org-1',
            key: 'email.invoiceIssued',
            vars: { number: 'TSL-2026-000001', total: '100 DZD', dueDate: '15/12/2026' },
            link: '/app/billing',
          },
          {
            userId: 'u2',
            organizationId: 'org-1',
            key: 'email.invoiceIssued',
            vars: { number: 'TSL-2026-000001', total: '١٠٠ دج', dueDate: '15/12/2026' },
            link: '/app/billing',
          },
        ],
      },
    ]);
  });
});

describe('notifications', () => {
  it('reads and marks only the signed-in user’s notifications, in a user-only context', async () => {
    const contexts: unknown[] = [];
    const tx = {
      notification: {
        findMany: async () => [{ id: 'n1' }],
        count: async () => 3,
        updateMany: async ({ where }: { where: { id?: string; userId: string } }) => ({
          count: where.id === 'missing' ? 0 : 1,
        }),
      },
    };
    const prisma = {
      forTenant: async (ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => (
        contexts.push(ctx),
        fn(tx)
      ),
    };
    const service = new NotificationsService(prisma as never);
    await expect(service.list('u1')).resolves.toEqual({ items: [{ id: 'n1' }], unread: 3 });
    await expect(service.markRead('u1', 'missing')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(
      contexts.every(
        (c) => JSON.stringify(c) === JSON.stringify({ organizationId: null, userId: 'u1' }),
      ),
    ).toBe(true);
  });
});

describe('reports', () => {
  const tenant = (type: string): TenantInfo => ({
    userId: 'u',
    organizationId: 'o',
    organizationType: type as TenantInfo['organizationType'],
    organizationStatus: 'VERIFIED',
    permissions: new Set(),
  });
  const fake = (row: Record<string, unknown>) => {
    const tx = {
      $queryRaw: async (q: { sql: string }) =>
        q.sql.includes('generate_series') ? [{ month: '2026-11', value: '2' }] : [row],
    };
    return new ReportsService({
      forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as never);
  };

  it('computes the acceptance rate from the counts, and none when nothing was issued', async () => {
    await expect(
      fake({ quotationsIssued: 8, quotationsAccepted: 3 }).overview(tenant('SUPPLIER')),
    ).resolves.toMatchObject({
      kind: 'SUPPLIER',
      acceptanceRate: 37.5,
      requestsByMonth: [{ month: '2026-11', value: '2' }],
    });
    await expect(
      fake({ offersIssued: 0, offersAccepted: 0 }).overview(tenant('FINANCIAL_INSTITUTION')),
    ).resolves.toMatchObject({ acceptanceRate: null });
  });
});
