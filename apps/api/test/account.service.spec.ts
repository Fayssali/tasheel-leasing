/**
 * AccountService logic against an in-memory fake of the Prisma transaction.
 * Real SQL and RLS behaviour is covered by the integration test and the RLS suite.
 */
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountService } from '../src/auth/account.service';
import { verifyPassword } from '../src/auth/password';
import { formatUserToken, newSecret, parseUserToken, sha256 } from '../src/auth/tokens';
import type { OutgoingMail } from '../src/mail/mailer';

const USER = '0193a1b2-0000-7000-8000-000000000001';

interface Token {
  id: string;
  userId: string;
  purpose: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function setup() {
  const db = {
    user: {
      id: USER,
      email: 'amel@example.dz',
      firstName: 'Amel',
      locale: 'fr',
      passwordHash: 'old',
      emailVerifiedAt: null as Date | null,
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60_000) as Date | null,
      deletedAt: null,
    },
    tokens: [] as Token[],
    sessions: [
      { id: 's1', userId: USER, revokedAt: null as Date | null },
      { id: 's2', userId: USER, revokedAt: null as Date | null },
    ],
    audit: [] as string[],
  };
  const matches = (t: Token, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (t as unknown as Record<string, unknown>)[k] === v);

  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id === USER || where.email === db.user.email ? { ...db.user } : null,
      update: async ({ data }: { data: Partial<typeof db.user> }) => Object.assign(db.user, data),
    },
    userToken: {
      create: async ({ data }: { data: Omit<Token, 'id' | 'usedAt'> }) => {
        db.tokens.push({ id: `t${db.tokens.length + 1}`, usedAt: null, ...data });
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        db.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Token> }) =>
        Object.assign(
          db.tokens.find((t) => t.id === where.id)!,
          data,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Token>;
      }) => {
        db.tokens.filter((t) => matches(t, where)).forEach((t) => Object.assign(t, data));
      },
    },
    session: {
      updateMany: async ({ data }: { data: { revokedAt: Date } }) => {
        db.sessions.filter((s) => !s.revokedAt).forEach((s) => (s.revokedAt = data.revokedAt));
      },
    },
  };
  const prisma = {
    user: tx.user,
    forTenant: jest.fn(async (_ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const sent: OutgoingMail[] = [];
  const mailer = { send: jest.fn(async (m: OutgoingMail) => void sent.push(m)) };
  const audit = {
    record: jest.fn(async (_tx: unknown, e: { action: string }) => void db.audit.push(e.action)),
  };
  const config = new ConfigService({ WEB_APP_URL: 'https://app.test' });
  const service = new AccountService(prisma as never, audit as never, mailer as never, config);
  const flush = () => new Promise((r) => setImmediate(r));
  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };
  const tokenFromMail = (m: OutgoingMail) =>
    decodeURIComponent(/token=([^\s"&<]+)/.exec(m.text)![1]!);
  return { db, service, sent, flush, meta, tokenFromMail };
}

describe('AccountService', () => {
  it('sends a verification link, and the link verifies the email once', async () => {
    const { db, service, sent, flush, meta, tokenFromMail } = setup();
    await expect(service.sendEmailVerification(USER, meta)).resolves.toBe('sent');
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('https://app.test/verify-email?token=');

    const token = tokenFromMail(sent[0]!);
    expect(parseUserToken(token)?.userId).toBe(USER);
    expect(db.tokens[0]!.tokenHash).not.toContain(parseUserToken(token)!.secret);

    await service.confirmEmail(token, meta);
    expect(db.user.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(service.confirmEmail(token, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sendEmailVerification(USER, meta)).resolves.toBe('already_verified');
  });

  it('keeps only the latest link valid', async () => {
    const { service, sent, flush, meta, tokenFromMail } = setup();
    await service.sendEmailVerification(USER, meta);
    await service.sendEmailVerification(USER, meta);
    await flush();
    const [first, second] = sent.map(tokenFromMail);
    await expect(service.confirmEmail(first!, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.confirmEmail(second!, meta)).resolves.toBeUndefined();
  });

  it('does nothing visible for an unknown email on forgot-password', async () => {
    const { service, sent, flush, meta, db } = setup();
    await service.forgotPassword('nobody@example.dz', meta);
    await flush();
    expect(sent).toHaveLength(0);
    expect(db.tokens).toHaveLength(0);
  });

  it('resets the password, clears lockout, signs out everywhere and notifies', async () => {
    const { db, service, sent, flush, meta, tokenFromMail } = setup();
    await service.forgotPassword(db.user.email, meta);
    await flush();
    const token = tokenFromMail(sent[0]!);

    await service.resetPassword(token, 'a-brand-new-password', meta);
    await flush();

    await expect(verifyPassword(db.user.passwordHash, 'a-brand-new-password')).resolves.toBe(true);
    expect(db.user.failedLoginCount).toBe(0);
    expect(db.user.lockedUntil).toBeNull();
    expect(db.user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(db.sessions.every((s) => s.revokedAt)).toBe(true);
    expect(db.audit).toContain('auth.password_reset_completed');
    expect(sent[1]!.subject).toContain('mot de passe a été modifié');

    // The link is single-use.
    await expect(service.resetPassword(token, 'another-new-password', meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects expired, wrong-purpose, malformed and forged tokens', async () => {
    const { db, service, meta } = setup();
    const secret = newSecret();
    db.tokens.push({
      id: 'x',
      userId: USER,
      purpose: 'PASSWORD_RESET',
      tokenHash: sha256(secret),
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
    });
    await expect(
      service.resetPassword(formatUserToken(USER, secret), 'a-brand-new-password', meta),
    ).rejects.toBeInstanceOf(BadRequestException);

    const verifySecret = newSecret();
    db.tokens.push({
      id: 'y',
      userId: USER,
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: sha256(verifySecret),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    await expect(
      service.resetPassword(formatUserToken(USER, verifySecret), 'a-brand-new-password', meta),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.confirmEmail('garbage', meta)).rejects.toBeInstanceOf(BadRequestException);
    const otherUser = '0193a1b2-0000-7000-8000-000000000099';
    await expect(
      service.confirmEmail(formatUserToken(otherUser, verifySecret), meta),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.user.passwordHash).toBe('old');
  });
});
