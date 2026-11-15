/**
 * End-to-end auth flow against a real, migrated and seeded PostgreSQL, with the API
 * connected as tasheel_app (RLS enforced). Runs in CI (`pnpm --filter @tasheel/api test:int`).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const run = randomUUID().slice(0, 8);
const password = 'integration-test-password';

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const rt = cookies.find((c) => c.startsWith('tasheel_rt='));
  if (!rt) throw new Error('No refresh cookie set');
  return rt.split(';')[0]!;
}

describe('Auth flow (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
  });

  afterAll(() => app.close());

  const register = (label: string, organizationType: string) =>
    request(http)
      .post('/api/v1/auth/register')
      .send({
        organizationType,
        legalName: `${label} ${run} (fictif)`,
        email: `${label.toLowerCase()}-${run}@int-test.local`,
        password,
        firstName: label,
        lastName: 'Test',
        acceptTerms: true,
      });

  it('runs register → me → tenant routes → isolation → refresh rotation → reuse detection → logout', async () => {
    // Register two organizations.
    const a = await register('Alpha', 'BUSINESS').expect(201);
    const b = await register('Beta', 'SUPPLIER').expect(201);
    const tokenA = `Bearer ${a.body.accessToken}`;
    const tokenB = `Bearer ${b.body.accessToken}`;

    // Duplicate email is refused.
    await register('Alpha', 'BUSINESS').expect(409);

    // me: one membership, admin role, pending verification.
    const meA = await request(http).get('/api/v1/auth/me').set('Authorization', tokenA).expect(200);
    expect(meA.body.memberships).toHaveLength(1);
    const orgA = meA.body.memberships[0];
    expect(orgA).toMatchObject({ type: 'BUSINESS', status: 'PENDING_VERIFICATION' });
    expect(orgA.roles.map((r: { code: string }) => r.code)).toEqual(['business_admin']);
    const meB = await request(http).get('/api/v1/auth/me').set('Authorization', tokenB).expect(200);
    const orgB = meB.body.memberships[0];

    // Tenant route with own organization works; permissions come from the system role.
    const current = await request(http)
      .get('/api/v1/organizations/current')
      .set('Authorization', tokenA)
      .set('X-Organization-Id', orgA.organizationId)
      .expect(200);
    expect(current.body.permissions).toContain('member.invite');
    expect(current.body).not.toHaveProperty('passwordHash');

    const members = await request(http)
      .get('/api/v1/organizations/current/members')
      .set('Authorization', tokenA)
      .set('X-Organization-Id', orgA.organizationId)
      .expect(200);
    expect(members.body).toHaveLength(1);
    expect(JSON.stringify(members.body)).not.toMatch(/password|mfa/i);

    // Cross-tenant: A cannot act in B's organization.
    await request(http)
      .get('/api/v1/organizations/current')
      .set('Authorization', tokenA)
      .set('X-Organization-Id', orgB.organizationId)
      .expect(403);

    // Refresh rotation: the old cookie works once, the new one replaces it.
    const cookie1 = refreshCookie(a);
    const r1 = await request(http).post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(200);
    const cookie2 = refreshCookie(r1);
    expect(cookie2).not.toEqual(cookie1);

    // Reuse of the rotated token revokes the session; the newest token then fails too.
    await request(http).post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(401);
    await request(http).post('/api/v1/auth/refresh').set('Cookie', cookie2).expect(401);

    // Fresh login, then logout revokes that session.
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `alpha-${run}@int-test.local`, password })
      .expect(200);
    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(login))
      .expect(401);
  });

  it('locks the account after 5 wrong passwords without revealing it', async () => {
    await register('Gamma', 'FINANCIAL_INSTITUTION').expect(201);
    const email = `gamma-${run}@int-test.local`;

    for (let i = 0; i < 5; i++) {
      const res = await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password-123' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    // Correct password is now refused with the same message.
    const locked = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);
    expect(locked.body.code).toBe('INVALID_CREDENTIALS');

    // Unknown email gives the same answer.
    const unknown = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `nobody-${run}@int-test.local`, password })
      .expect(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
  });
});
