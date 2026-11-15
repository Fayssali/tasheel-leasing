/**
 * HTTP-level tests through the real global guard chain (JWT → tenant → permissions)
 * with the database layer mocked. Database behaviour (RLS, Prisma queries) is covered by
 * test-int/auth.int-spec.ts, which needs PostgreSQL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountService } from '../src/auth/account.service';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

const USER = '0193a1b2-0000-7000-8000-000000000001';
const ORG = '0193a1b2-0000-7000-8000-0000000000aa';

const neverThrottled = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};

const validRegistration = {
  organizationType: 'BUSINESS',
  legalName: 'Entreprise Fictive SARL',
  email: 'Owner@Example.dz ',
  password: 'a-long-enough-password',
  firstName: 'Amel',
  lastName: 'Test',
  acceptTerms: true,
};

describe('Auth and access control (HTTP)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
  };
  const prisma = { forTenant: jest.fn(), $queryRaw: jest.fn(), $disconnect: jest.fn() };
  const accountService = {
    sendEmailVerification: jest.fn(),
    confirmEmail: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };

  const tokens = {
    accessToken: 'access.jwt',
    expiresIn: 900,
    refreshToken: `${USER}.0193a1b2-0000-7000-8000-000000000002.${'x'.repeat(43)}`,
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(AccountService)
      .useValue(accountService)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // Rate limiting is tested separately below; here every request counts as the first.
      .overrideProvider(ThrottlerStorage)
      .useValue(neverThrottled)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const bearer = async (sub = USER) => `Bearer ${await jwt.signAsync({ sub, sid: 'session-1' })}`;

  describe('registration and login', () => {
    it('registers, normalizes the email and sets an httpOnly refresh cookie scoped to /api/v1/auth', async () => {
      authService.register.mockResolvedValueOnce(tokens);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      expect(res.body).toEqual({ accessToken: 'access.jwt', tokenType: 'Bearer', expiresIn: 900 });
      expect(authService.register.mock.calls[0][0].email).toBe('owner@example.dz');
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/tasheel_rt=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(res.body.refreshToken).toBeUndefined();
    });

    it.each([
      ['a short password', { password: 'short' }],
      ['no consent', { acceptTerms: false }],
      ['self-registration as the platform', { organizationType: 'PLATFORM' }],
      ['an invalid email', { email: 'not-an-email' }],
      ['an unknown field', { isAdmin: true }],
    ])('rejects registration with %s', async (_label, patch) => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...validRegistration, ...patch })
        .expect(400);
      expect(authService.register).not.toHaveBeenCalled();
    });

    it('rejects an incomplete login body', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.dz' })
        .expect(400);
    });

    it('reads the refresh token from the cookie only', async () => {
      authService.refresh.mockResolvedValueOnce(tokens);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `tasheel_rt=${tokens.refreshToken}`)
        .expect(200);
      expect(authService.refresh.mock.calls[0][0]).toBe(tokens.refreshToken);
    });
  });

  describe('email verification and password reset', () => {
    it('answers 202 to forgot-password without waiting for the lookup', async () => {
      accountService.forgotPassword.mockReturnValueOnce(new Promise(() => undefined)); // never resolves
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'Unknown@Example.dz' })
        .expect(202);
      expect(res.body).toEqual({ status: 'accepted' });
      expect(accountService.forgotPassword.mock.calls[0][0]).toBe('unknown@example.dz');
    });

    it('validates the reset body before calling the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ token: 'x'.repeat(80), password: 'short' })
        .expect(400);
      expect(accountService.resetPassword).not.toHaveBeenCalled();
    });

    it('confirms an email token publicly', async () => {
      accountService.confirmEmail.mockResolvedValueOnce(undefined);
      await request(app.getHttpServer())
        .post('/api/v1/auth/email/verify')
        .send({ token: 'x'.repeat(80) })
        .expect(204);
    });

    it('requires sign-in to re-send the verification email', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/email/verification').expect(401);
      accountService.sendEmailVerification.mockResolvedValueOnce('sent');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/verification')
        .set('Authorization', await bearer())
        .expect(202);
      expect(res.body).toEqual({ status: 'sent' });
    });
  });

  describe('authentication', () => {
    it('keeps the health check public', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([1]);
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });

    it('rejects protected routes without a token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged token', async () => {
      const forged = new JwtService({ secret: 'another-secret' }).sign({ sub: USER, sid: 's' });
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('accepts a valid token', async () => {
      authService.me.mockResolvedValueOnce({ user: { id: USER }, memberships: [] });
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', await bearer())
        .expect(200);
      expect(authService.me).toHaveBeenCalledWith(USER);
    });
  });

  describe('organization and permissions', () => {
    const memberWith = (permissions: string[], status = 'VERIFIED') => ({
      organization: { type: 'BUSINESS', status, deletedAt: null },
      roles: [{ role: { permissions: permissions.map((permissionCode) => ({ permissionCode })) } }],
    });

    it('requires the X-Organization-Id header on tenant routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations/current')
        .set('Authorization', await bearer())
        .expect(400);
      expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
    });

    it('refuses an organization the user is not a member of', async () => {
      prisma.forTenant.mockResolvedValueOnce(null);
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations/current')
        .set('Authorization', await bearer())
        .set('X-Organization-Id', ORG)
        .expect(403);
      expect(res.body.code).toBe('NOT_A_MEMBER');
    });

    it('refuses a suspended organization', async () => {
      prisma.forTenant.mockResolvedValueOnce(memberWith(['organization.read'], 'SUSPENDED'));
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations/current')
        .set('Authorization', await bearer())
        .set('X-Organization-Id', ORG)
        .expect(403);
      expect(res.body.code).toBe('ORGANIZATION_BLOCKED');
    });

    it('refuses a member without the required permission', async () => {
      prisma.forTenant.mockResolvedValueOnce(memberWith(['organization.read']));
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations/current/members')
        .set('Authorization', await bearer())
        .set('X-Organization-Id', ORG)
        .expect(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('allows a member with the permission and scopes the query to the tenant', async () => {
      prisma.forTenant
        .mockResolvedValueOnce(memberWith(['organization.read']))
        .mockResolvedValueOnce({ id: ORG, legalName: 'Entreprise Fictive SARL' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations/current')
        .set('Authorization', await bearer())
        .set('X-Organization-Id', ORG)
        .expect(200);

      expect(res.body).toMatchObject({ id: ORG, permissions: ['organization.read'] });
      expect(prisma.forTenant.mock.calls[1][0]).toMatchObject({
        organizationId: ORG,
        userId: USER,
      });
    });
  });
});

describe('Rate limiting on credential endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ login: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(PrismaService)
      .useValue({ forTenant: jest.fn(), $disconnect: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  it('blocks the 6th registration attempt within a minute from the same client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});
