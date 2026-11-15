/**
 * Admin console on a real, migrated and seeded PostgreSQL with RLS.
 * A fresh platform administrator is created per run through the admin connection.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@tasheel/db';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { base32Decode, hotp, timeStep } from '../src/auth/mfa/totp';
import { hashPassword } from '../src/auth/password';
import { Mailer, type OutgoingMail } from '../src/mail/mailer';

const run = randomUUID().slice(0, 8);
const password = 'integration-test-password';
const outbox: OutgoingMail[] = [];

describe('Admin console (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
  let adminAuth: Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer)
      .useValue({ send: async (m: OutgoingMail) => void outbox.push(m) })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    http = app.getHttpServer();

    // Fresh platform admin for this run.
    const platform =
      (await adminDb.organization.findFirst({ where: { type: 'PLATFORM' } })) ??
      (await adminDb.organization.create({
        data: { type: 'PLATFORM', legalName: 'Tasheel (test)', status: 'VERIFIED' },
      }));
    const role = await adminDb.role.findFirstOrThrow({
      where: { organizationId: null, code: 'platform_super_admin' },
    });
    const email = `staff-${run}@int-test.local`;
    const user = await adminDb.user.create({
      data: {
        email,
        firstName: 'Staff',
        lastName: 'Test',
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
    const member = await adminDb.organizationMember.create({
      data: { organizationId: platform.id, userId: user.id },
    });
    await adminDb.memberRole.create({
      data: { memberId: member.id, roleId: role.id, organizationId: platform.id },
    });

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const bearer = `Bearer ${login.body.accessToken}`;

    // Platform staff are blocked until MFA is on.
    await request(http)
      .get('/api/v1/admin/kpis')
      .set({ Authorization: bearer, 'X-Organization-Id': platform.id })
      .expect(403);
    const setup = await request(http)
      .post('/api/v1/auth/mfa/setup')
      .set('Authorization', bearer)
      .send({ password })
      .expect(200);
    const code = hotp(base32Decode(setup.body.secret), timeStep(new Date()));
    await request(http)
      .post('/api/v1/auth/mfa/enable')
      .set('Authorization', bearer)
      .send({ code })
      .expect(200);

    adminAuth = { Authorization: bearer, 'X-Organization-Id': platform.id };
  });

  afterAll(async () => {
    await adminDb.$disconnect();
    await app.close();
  });

  async function registerBusiness(label: string) {
    const email = `${label}-${run}@int-test.local`;
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({
        organizationType: 'SUPPLIER',
        legalName: `${label} ${run} (fictif)`,
        email,
        password,
        firstName: label,
        lastName: 'Test',
        acceptTerms: true,
      })
      .expect(201);
    const auth = `Bearer ${res.body.accessToken}`;
    const me = await request(http).get('/api/v1/auth/me').set('Authorization', auth).expect(200);
    return { email, auth, orgId: me.body.memberships[0].organizationId as string };
  }

  it('works the verification queue: list, verify, reject with reason, suspend, reactivate', async () => {
    const good = await registerBusiness('goodsupplier');
    const bad = await registerBusiness('badsupplier');

    const kpis = await request(http).get('/api/v1/admin/kpis').set(adminAuth).expect(200);
    expect(kpis.body.pendingVerification).toBeGreaterThanOrEqual(2);

    const queue = await request(http)
      .get('/api/v1/admin/organizations')
      .query({ status: 'PENDING_VERIFICATION', q: run, limit: 100 })
      .set(adminAuth)
      .expect(200);
    const ids = queue.body.items.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([good.orgId, bad.orgId]));

    const detail = await request(http)
      .get(`/api/v1/admin/organizations/${good.orgId}`)
      .set(adminAuth)
      .expect(200);
    expect(detail.body.members[0].user.email).toBe(good.email);
    expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|mfaSecret/);

    await request(http)
      .post(`/api/v1/admin/organizations/${good.orgId}/verify`)
      .set(adminAuth)
      .send({})
      .expect(200);
    await request(http)
      .post(`/api/v1/admin/organizations/${good.orgId}/verify`)
      .set(adminAuth)
      .send({})
      .expect(409);
    await request(http)
      .post(`/api/v1/admin/organizations/${bad.orgId}/reject`)
      .set(adminAuth)
      .send({})
      .expect(400);
    await request(http)
      .post(`/api/v1/admin/organizations/${bad.orgId}/reject`)
      .set(adminAuth)
      .send({ reason: 'Documents illisibles (test)' })
      .expect(200);

    // The supplier sees its new status; a rejected one is blocked.
    const goodOrg = await request(http)
      .get('/api/v1/organizations/current')
      .set({ Authorization: good.auth, 'X-Organization-Id': good.orgId })
      .expect(200);
    expect(goodOrg.body.status).toBe('VERIFIED');
    await request(http)
      .get('/api/v1/organizations/current')
      .set({ Authorization: bad.auth, 'X-Organization-Id': bad.orgId })
      .expect(403);

    // Suspension cuts access; reactivation restores VERIFIED.
    await request(http)
      .post(`/api/v1/admin/organizations/${good.orgId}/suspend`)
      .set(adminAuth)
      .send({ reason: 'Contrôle (test)' })
      .expect(200);
    await request(http)
      .get('/api/v1/organizations/current')
      .set({ Authorization: good.auth, 'X-Organization-Id': good.orgId })
      .expect(403);
    const back = await request(http)
      .post(`/api/v1/admin/organizations/${good.orgId}/reactivate`)
      .set(adminAuth)
      .send({})
      .expect(200);
    expect(back.body.status).toBe('VERIFIED');

    // Every decision is in the audit log of the target organization.
    const logs = await request(http)
      .get('/api/v1/admin/audit-logs')
      .query({ organizationId: good.orgId, action: 'organization.' })
      .set(adminAuth)
      .expect(200);
    expect(logs.body.items.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining([
        'organization.verified',
        'organization.suspended',
        'organization.reactivated',
      ]),
    );

    // Admins of the organization were emailed.
    await new Promise((r) => setTimeout(r, 50));
    expect(outbox.some((m) => m.to === good.email && /vérifiée/.test(m.subject))).toBe(true);
  });

  it('refuses the admin console to a non-platform administrator', async () => {
    const outsider = await registerBusiness('outsider');
    await request(http)
      .get('/api/v1/admin/organizations')
      .set({ Authorization: outsider.auth, 'X-Organization-Id': outsider.orgId })
      .expect(403);
  });
});
