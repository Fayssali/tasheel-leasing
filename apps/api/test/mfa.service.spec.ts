import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { MfaService } from '../src/auth/mfa/mfa.service';
import { base32Decode, hotp, timeStep } from '../src/auth/mfa/totp';
import { hashPassword } from '../src/auth/password';

const USER = '0193a1b2-0000-7000-8000-000000000001';

async function setup(orgType = 'BUSINESS') {
  const user = {
    id: USER,
    email: 'samia@example.dz',
    passwordHash: await hashPassword('the-right-password'),
    mfaEnabled: false,
    mfaSecret: null as string | null,
    mfaPendingSecret: null as string | null,
    mfaRecoveryCodes: [] as string[],
    mfaLastUsedStep: null as number | null,
    deletedAt: null,
  };
  const sessions = [
    { id: 'current', revokedAt: null as Date | null },
    { id: 'other-device', revokedAt: null as Date | null },
  ];
  const audit: string[] = [];

  const userApi = {
    findUnique: async () => ({ ...user, mfaRecoveryCodes: [...user.mfaRecoveryCodes] }),
    update: async ({ data }: { data: Partial<typeof user> }) => Object.assign(user, data),
    updateMany: async ({
      where,
      data,
    }: {
      where: { OR: Array<{ mfaLastUsedStep: null | { lt: number } }> };
      data: { mfaLastUsedStep: number };
    }) => {
      const ok = where.OR.some((c) =>
        c.mfaLastUsedStep === null
          ? user.mfaLastUsedStep === null
          : user.mfaLastUsedStep !== null && user.mfaLastUsedStep < c.mfaLastUsedStep.lt,
      );
      if (ok) Object.assign(user, data);
      return { count: ok ? 1 : 0 };
    },
  };
  const tx = {
    user: userApi,
    session: {
      updateMany: async ({ where }: { where: { NOT: { id: string } } }) => {
        sessions
          .filter((s) => s.id !== where.NOT.id && !s.revokedAt)
          .forEach((s) => (s.revokedAt = new Date()));
      },
    },
    organizationMember: { findMany: async () => [{ organization: { type: orgType } }] },
  };
  const prisma = {
    user: userApi,
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    // Emulates: array_remove(...) WHERE id = $userId AND $hash = ANY(codes)
    $executeRaw: async (_strings: TemplateStringsArray, hash: string) => {
      if (!user.mfaRecoveryCodes.includes(hash)) return 0;
      user.mfaRecoveryCodes = user.mfaRecoveryCodes.filter((h) => h !== hash);
      return 1;
    },
  };
  const auditService = {
    record: async (_: unknown, e: { action: string }) => void audit.push(e.action),
  };
  const config = new ConfigService({ MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
  const service = new MfaService(prisma as never, auditService as never, config);
  const meta = { ipAddress: null, userAgent: null };
  return { service, user, sessions, audit, meta };
}

const codeFor = (secret: string, offsetSteps = 0) =>
  hotp(base32Decode(secret), timeStep(new Date()) + offsetSteps);

describe('MfaService', () => {
  it('requires the current password to start setup and stores the secret encrypted', async () => {
    const { service, user, meta } = await setup();
    await expect(service.startSetup(USER, 'wrong', meta)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const { secret, otpauthUri } = await service.startSetup(USER, 'the-right-password', meta);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(user.mfaPendingSecret).toMatch(/^v1\./);
    expect(user.mfaPendingSecret).not.toContain(secret);
    expect(user.mfaEnabled).toBe(false);
  });

  it('enables MFA with a valid code, returns 10 recovery codes once and signs out other devices', async () => {
    const { service, user, sessions, audit, meta } = await setup();
    const { secret } = await service.startSetup(USER, 'the-right-password', meta);

    await expect(service.confirmSetup(USER, 'current', '000000', meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const codes = await service.confirmSetup(USER, 'current', codeFor(secret), meta);

    expect(codes).toHaveLength(10);
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaPendingSecret).toBeNull();
    expect(user.mfaRecoveryCodes).toHaveLength(10);
    expect(user.mfaRecoveryCodes).not.toContain(codes[0]);
    expect(sessions.find((s) => s.id === 'current')!.revokedAt).toBeNull();
    expect(sessions.find((s) => s.id === 'other-device')!.revokedAt).toBeInstanceOf(Date);
    expect(audit).toContain('auth.mfa_enabled');
    await expect(service.startSetup(USER, 'the-right-password', meta)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to replay the code used to enable, accepts the next one once', async () => {
    const { service, meta } = await setup();
    const { secret } = await service.startSetup(USER, 'the-right-password', meta);
    const enableCode = codeFor(secret);
    await service.confirmSetup(USER, 'current', enableCode, meta);

    await expect(service.consumeCode(USER, enableCode)).resolves.toBeNull();
    const next = codeFor(secret, 1);
    await expect(service.consumeCode(USER, next)).resolves.toBe('totp');
    await expect(service.consumeCode(USER, next)).resolves.toBeNull();
  });

  it('accepts each recovery code exactly once, in any letter case', async () => {
    const { service, user, meta } = await setup();
    const { secret } = await service.startSetup(USER, 'the-right-password', meta);
    const codes = await service.confirmSetup(USER, 'current', codeFor(secret), meta);

    await expect(service.consumeCode(USER, codes[3]!.toUpperCase())).resolves.toBe('recovery');
    await expect(service.consumeCode(USER, codes[3]!)).resolves.toBeNull();
    expect(user.mfaRecoveryCodes).toHaveLength(9);
  });

  it('lets a business user disable MFA with password and code', async () => {
    const { service, user, meta } = await setup('BUSINESS');
    const { secret } = await service.startSetup(USER, 'the-right-password', meta);
    await service.confirmSetup(USER, 'current', codeFor(secret), meta);

    await service.disable(USER, 'the-right-password', codeFor(secret, 1), meta);
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaRecoveryCodes).toEqual([]);
  });

  it('forbids disabling MFA for members of a financial institution', async () => {
    const { service, user, meta } = await setup('FINANCIAL_INSTITUTION');
    const { secret } = await service.startSetup(USER, 'the-right-password', meta);
    await service.confirmSetup(USER, 'current', codeFor(secret), meta);

    await expect(
      service.disable(USER, 'the-right-password', codeFor(secret, 1), meta),
    ).rejects.toMatchObject({
      response: { code: 'MFA_REQUIRED_BY_POLICY' },
    });
    expect(user.mfaEnabled).toBe(true);
    await expect(service.isRequiredFor(USER)).resolves.toBe(true);
  });
});
