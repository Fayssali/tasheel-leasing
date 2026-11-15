/**
 * MembersService guard rails against an in-memory fake transaction. Full flows on
 * PostgreSQL + RLS are in test-int/members.int-spec.ts.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembersService } from '../src/organizations/members.service';
import { formatInvitationToken, newSecret, sha256 } from '../src/auth/tokens';
import type { TenantInfo } from '../src/common/request-context';

const ORG = '0193a1b2-0000-7000-8000-0000000000aa';
const ADMIN = '0193a1b2-0000-7000-8000-000000000001';
const OTHER = '0193a1b2-0000-7000-8000-000000000002';

const role = (id: string, code: string, permissions: string[]) => ({
  id,
  code,
  name: { fr: code },
  organizationType: 'BUSINESS',
  organizationId: null,
  permissions: permissions.map((permissionCode) => ({ permissionCode })),
});
const ADMIN_ROLE = role('r-admin', 'business_admin', [
  'organization.read',
  'member.read',
  'member.invite',
  'member.manage',
]);
const MEMBER_ROLE = role('r-member', 'business_member', ['organization.read', 'member.read']);
const ROLES = [ADMIN_ROLE, MEMBER_ROLE];

function tenant(permissions: string[], userId = ADMIN): TenantInfo {
  return {
    userId,
    organizationId: ORG,
    organizationType: 'BUSINESS',
    organizationStatus: 'VERIFIED',
    permissions: new Set(permissions),
  };
}

function setup(opts: { managers?: number; targetRole?: typeof ADMIN_ROLE } = {}) {
  const invitations: Array<Record<string, unknown>> = [];
  const target = {
    id: 'm-other',
    userId: OTHER,
    status: 'ACTIVE',
    roles: [{ role: opts.targetRole ?? MEMBER_ROLE }],
  };
  const tx = {
    role: {
      findFirst: async ({ where }: { where: { code: string } }) =>
        ROLES.find((r) => r.code === where.code) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        ROLES.find((r) => r.id === where.id) ?? null,
      findMany: async () => ROLES,
    },
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.id === ADMIN ? { email: 'admin@x.dz', firstName: 'A', lastName: 'B' } : null,
    },
    organization: {
      findUnique: async () => ({
        legalName: 'Fictive SARL',
        defaultLocale: 'fr',
        status: 'VERIFIED',
        deletedAt: null,
        type: 'BUSINESS',
      }),
    },
    organizationMember: {
      findFirst: async ({ where }: { where: { id?: string; userId?: string } }) =>
        where.id === target.id ? target : null,
      count: async () => opts.managers ?? 1,
      update: jest.fn(),
    },
    memberRole: { deleteMany: jest.fn(), create: jest.fn() },
    invitation: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => void invitations.push(data),
      ),
      findFirst: async ({ where }: { where: { id: string } }) =>
        invitations.find((i) => i.id === where.id) ?? null,
    },
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const sent: Array<{ text: string }> = [];
  const service = new MembersService(
    prisma as never,
    { record: async () => undefined } as never,
    { send: async (m: { text: string }) => void sent.push(m) } as never,
    new ConfigService({ WEB_APP_URL: 'https://app.test' }),
    {} as never,
  );
  const meta = { ipAddress: null, userAgent: null };
  return { service, tx, invitations, sent, meta, target };
}

const adminPerms = ADMIN_ROLE.permissions.map((p) => p.permissionCode);

describe('MembersService guard rails', () => {
  it('sends an invitation link that carries the organization and stores only a hash', async () => {
    const { service, invitations, sent, meta } = setup();
    await service.invite(
      tenant(adminPerms),
      { email: 'New@Example.dz', roleCode: 'business_member' },
      meta,
    );
    await new Promise((r) => setImmediate(r));

    expect(invitations[0]).toMatchObject({
      organizationId: ORG,
      email: 'new@example.dz',
      roleId: 'r-member',
    });
    const token = decodeURIComponent(/token=([^\s"&<]+)/.exec(sent[0]!.text)![1]!);
    expect(token.startsWith(`${ORG}.`)).toBe(true);
    expect(invitations[0]!.tokenHash).toBe(sha256(token.split('.')[2]!));
  });

  it('refuses to invite someone with more permissions than the inviter', async () => {
    const { service, meta } = setup();
    const inviterWithoutManage = tenant(['organization.read', 'member.read', 'member.invite']);
    await expect(
      service.invite(inviterWithoutManage, { email: 'x@y.dz', roleCode: 'business_admin' }, meta),
    ).rejects.toMatchObject({ response: { code: 'ROLE_EXCEEDS_YOUR_PERMISSIONS' } });
  });

  it('rejects unknown roles', async () => {
    const { service, meta } = setup();
    await expect(
      service.invite(
        tenant(adminPerms),
        { email: 'x@y.dz', roleCode: 'platform_super_admin' },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forbids changing your own role or status', async () => {
    const { service, meta } = setup();
    const self = { ...tenant(adminPerms, OTHER) };
    await expect(
      service.updateMember(self, 'm-other', { status: 'DISABLED' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CANNOT_MODIFY_SELF' },
    });
  });

  it('keeps at least one administrator', async () => {
    const { service, meta } = setup({ managers: 1, targetRole: ADMIN_ROLE });
    await expect(
      service.updateMember(tenant(adminPerms), 'm-other', { status: 'DISABLED' }, meta),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateMember(tenant(adminPerms), 'm-other', { roleCode: 'business_member' }, meta),
    ).rejects.toMatchObject({ response: { code: 'LAST_ADMIN' } });
  });

  it('allows demoting an admin when another admin remains', async () => {
    const { service, meta, tx } = setup({ managers: 2, targetRole: ADMIN_ROLE });
    await expect(
      service.updateMember(tenant(adminPerms), 'm-other', { roleCode: 'business_member' }, meta),
    ).resolves.toMatchObject({
      role: 'business_member',
    });
    expect(tx.memberRole.create).toHaveBeenCalledWith({
      data: { memberId: 'm-other', roleId: 'r-member', organizationId: ORG },
    });
  });

  it('refuses to modify a member who holds more permissions than you', async () => {
    const { service, meta } = setup({ managers: 2, targetRole: ADMIN_ROLE });
    await expect(
      service.updateMember(
        tenant(['member.read', 'member.manage', 'organization.read']),
        'm-other',
        { status: 'DISABLED' },
        meta,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects invitation tokens that are malformed, forged, expired or revoked', async () => {
    const { service, invitations } = setup();
    const secret = newSecret();
    const id = '0193a1b2-0000-7000-8000-0000000000c1';
    const base = {
      id,
      organizationId: ORG,
      email: 'z@y.dz',
      roleId: 'r-member',
      tokenHash: sha256(secret),
      acceptedAt: null,
      revokedAt: null,
    };

    await expect(service.preview('garbage')).rejects.toMatchObject({
      response: { code: 'INVALID_INVITATION' },
    });

    invitations.push({ ...base, expiresAt: new Date(Date.now() + 60_000) });
    await expect(
      service.preview(formatInvitationToken(ORG, id, newSecret())),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.preview(formatInvitationToken(ORG, id, secret))).resolves.toMatchObject({
      email: 'z@y.dz',
      existingAccount: false,
    });

    invitations[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(service.preview(formatInvitationToken(ORG, id, secret))).rejects.toBeInstanceOf(
      BadRequestException,
    );

    invitations[0]!.expiresAt = new Date(Date.now() + 60_000);
    invitations[0]!.revokedAt = new Date();
    await expect(service.preview(formatInvitationToken(ORG, id, secret))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
