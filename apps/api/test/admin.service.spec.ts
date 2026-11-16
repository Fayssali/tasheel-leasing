import { buildMail } from '../src/mail/templates';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService, type AdminAction } from '../src/admin/admin.service';
import type { TenantInfo } from '../src/common/request-context';

const PLATFORM_ADMIN: TenantInfo = {
  userId: '0193a1b2-0000-7000-8000-000000000001',
  organizationId: '0193a1b2-0000-7000-8000-0000000000ff',
  organizationType: 'PLATFORM',
  organizationStatus: 'VERIFIED',
  permissions: new Set(['admin.organization.verify']),
};
const TARGET = '0193a1b2-0000-7000-8000-0000000000aa';

function setup(
  status: string,
  opts: { type?: string; verifiedAt?: Date | null; concurrent?: boolean } = {},
) {
  const org = {
    id: TARGET,
    type: opts.type ?? 'BUSINESS',
    status,
    legalName: 'Fictive SARL',
    email: null,
    defaultLocale: 'fr',
    verifiedAt: opts.verifiedAt ?? null,
    statusReason: null as string | null,
  };
  const audit: Array<{ action: string; organizationId: string | null }> = [];
  const sent: Array<{ to: string; subject: string }> = [];
  const tx = {
    organization: {
      findUnique: async () => ({ ...org }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { status: string };
        data: Record<string, unknown>;
      }) => {
        if (opts.concurrent || where.status !== org.status) return { count: 0 };
        Object.assign(org, data);
        return { count: 1 };
      },
    },
    organizationMember: {
      findMany: async () => [
        { user: { email: 'owner@fictive.dz', firstName: 'Amel', locale: 'fr' } },
      ],
    },
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new AdminService(
    prisma as never,
    {
      record: async (_: unknown, e: { action: string; organizationId: string | null }) =>
        void audit.push(e),
    } as never,
    {
      // Notifier.send: render each email as the real one would be, to check recipient and subject.
      send: async (
        _org: string,
        recipients: Array<{ email: string; firstName: string; locale: 'fr' | 'ar' | 'en' }>,
        key: Parameters<typeof buildMail>[0]['key'],
        vars: () => Record<string, string>,
      ) => {
        for (const r of recipients)
          sent.push(
            buildMail({ locale: r.locale, to: r.email, name: r.firstName, key, vars: vars() }),
          );
      },
    } as never,
  );
  const meta = { ipAddress: null, userAgent: null };
  const act = (action: AdminAction, reason?: string) =>
    service.changeStatus(PLATFORM_ADMIN, TARGET, action, reason, meta);
  const flush = () => new Promise((r) => setImmediate(r));
  return { org, audit, sent, act, flush };
}

describe('AdminService status changes', () => {
  it('verifies a pending organization, records who did it and notifies its admins', async () => {
    const { org, audit, sent, act, flush } = setup('PENDING_VERIFICATION');
    await expect(act('verify')).resolves.toEqual({ id: TARGET, status: 'VERIFIED' });
    await flush();
    expect(org).toMatchObject({ status: 'VERIFIED', verifiedById: PLATFORM_ADMIN.userId });
    expect(audit[0]).toMatchObject({ action: 'organization.verified', organizationId: TARGET });
    expect(sent[0]).toMatchObject({ to: 'owner@fictive.dz' });
    expect(sent[0]!.subject).toMatch(/vérifiée/);
  });

  it('requires a reason to reject or suspend, and stores it', async () => {
    const { org, act } = setup('PENDING_VERIFICATION');
    await expect(act('reject')).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    await act('reject', 'Registre du commerce illisible');
    expect(org).toMatchObject({
      status: 'REJECTED',
      statusReason: 'Registre du commerce illisible',
    });
  });

  it.each([
    ['reject', 'VERIFIED'],
    ['verify', 'SUSPENDED'],
    ['reactivate', 'VERIFIED'],
    ['suspend', 'REJECTED'],
  ] as Array<[AdminAction, string]>)(
    'refuses to %s an organization that is %s',
    async (action, status) => {
      const { act } = setup(status);
      await expect(act(action, 'a reason')).rejects.toMatchObject({
        response: { code: 'INVALID_TRANSITION' },
      });
    },
  );

  it('reactivates to VERIFIED if verified before, otherwise back to the queue', async () => {
    const verifiedBefore = setup('SUSPENDED', { verifiedAt: new Date('2026-01-01') });
    await expect(verifiedBefore.act('reactivate')).resolves.toMatchObject({ status: 'VERIFIED' });
    const neverVerified = setup('SUSPENDED');
    await expect(neverVerified.act('reactivate')).resolves.toMatchObject({
      status: 'PENDING_VERIFICATION',
    });
  });

  it('never changes the platform organization', async () => {
    const { act } = setup('VERIFIED', { type: 'PLATFORM' });
    await expect(act('suspend', 'test')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detects a concurrent decision instead of overwriting it', async () => {
    const { act } = setup('PENDING_VERIFICATION', { concurrent: true });
    await expect(act('verify')).rejects.toBeInstanceOf(ConflictException);
  });
});
