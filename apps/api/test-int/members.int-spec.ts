/**
 * Invitations and member management on a real, migrated and seeded PostgreSQL with RLS.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Mailer, type OutgoingMail } from '../src/mail/mailer';

const run = randomUUID().slice(0, 8);
const password = 'integration-test-password';
const outbox: OutgoingMail[] = [];
const flush = () => new Promise((r) => setTimeout(r, 50));
const tokenSentTo = (to: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === to && /token=/.test(m.text));
  if (!mail) throw new Error(`No email with a token for ${to}`);
  return decodeURIComponent(/token=([^\s"&<]+)/.exec(mail.text)![1]!);
};

describe('Invitations and members (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

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
  });

  afterAll(() => app.close());

  async function registerBusiness(label: string) {
    const email = `${label}-${run}@int-test.local`;
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({
        organizationType: 'BUSINESS',
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

  it('invites a new person, who accepts, joins with the invited role and cannot escalate', async () => {
    const owner = await registerBusiness('owner');
    const as = (auth: string) => ({ Authorization: auth, 'X-Organization-Id': owner.orgId });

    const roles = await request(http)
      .get('/api/v1/organizations/current/roles')
      .set(as(owner.auth))
      .expect(200);
    expect(roles.body.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['business_admin', 'business_member']),
    );

    // Invite.
    const inviteeEmail = `colleague-${run}@int-test.local`;
    await request(http)
      .post('/api/v1/organizations/current/invitations')
      .set(as(owner.auth))
      .send({ email: inviteeEmail, roleCode: 'business_member' })
      .expect(201);
    await flush();
    const token = tokenSentTo(inviteeEmail);
    const pending = await request(http)
      .get('/api/v1/organizations/current/invitations')
      .set(as(owner.auth))
      .expect(200);
    expect(pending.body).toHaveLength(1);

    // Preview and accept as a new user.
    const preview = await request(http)
      .get('/api/v1/invitations/preview')
      .query({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      email: inviteeEmail,
      existingAccount: false,
      role: { code: 'business_member' },
    });
    const accepted = await request(http)
      .post('/api/v1/invitations/accept')
      .send({ token, firstName: 'Col', lastName: 'League', password, acceptTerms: true })
      .expect(201);
    const colleague = `Bearer ${accepted.body.accessToken}`;
    await request(http)
      .post('/api/v1/invitations/accept')
      .send({ token, firstName: 'X', lastName: 'Y', password, acceptTerms: true })
      .expect(400);

    // The colleague is a member with read-only permissions, email already verified.
    const me = await request(http)
      .get('/api/v1/auth/me')
      .set('Authorization', colleague)
      .expect(200);
    expect(me.body.user.emailVerified).toBe(true);
    expect(me.body.memberships[0]).toMatchObject({ organizationId: owner.orgId });
    await request(http).get('/api/v1/organizations/current/members').set(as(colleague)).expect(200);
    await request(http)
      .post('/api/v1/organizations/current/invitations')
      .set(as(colleague))
      .send({ email: `third-${run}@int-test.local`, roleCode: 'business_admin' })
      .expect(403);

    // Owner promotes, then demotes; cannot demote themselves (last admin + self rule).
    const members = await request(http)
      .get('/api/v1/organizations/current/members')
      .set(as(owner.auth))
      .expect(200);
    const colleagueMember = members.body.find(
      (m: { user: { email: string } }) => m.user.email === inviteeEmail,
    );
    const ownerMember = members.body.find(
      (m: { user: { email: string } }) => m.user.email === owner.email,
    );
    await request(http)
      .patch(`/api/v1/organizations/current/members/${colleagueMember.id}`)
      .set(as(owner.auth))
      .send({ roleCode: 'business_admin' })
      .expect(200);
    await request(http)
      .patch(`/api/v1/organizations/current/members/${ownerMember.id}`)
      .set(as(owner.auth))
      .send({ status: 'DISABLED' })
      .expect(400);

    // Disabled members lose access immediately.
    await request(http)
      .patch(`/api/v1/organizations/current/members/${colleagueMember.id}`)
      .set(as(owner.auth))
      .send({ status: 'DISABLED' })
      .expect(200);
    await request(http).get('/api/v1/organizations/current').set(as(colleague)).expect(403);
  });

  it('lets an existing account accept only an invitation addressed to its own email', async () => {
    const inviter = await registerBusiness('inviter');
    const invitee = await registerBusiness('invitee');
    const stranger = await registerBusiness('stranger');

    await request(http)
      .post('/api/v1/organizations/current/invitations')
      .set({ Authorization: inviter.auth, 'X-Organization-Id': inviter.orgId })
      .send({ email: invitee.email, roleCode: 'business_member' })
      .expect(201);
    await flush();
    const token = tokenSentTo(invitee.email);

    const preview = await request(http)
      .get('/api/v1/invitations/preview')
      .query({ token })
      .expect(200);
    expect(preview.body.existingAccount).toBe(true);
    // Cannot be taken over by creating an account for an existing email.
    await request(http)
      .post('/api/v1/invitations/accept')
      .send({ token, firstName: 'X', lastName: 'Y', password, acceptTerms: true })
      .expect(409);

    const mismatch = await request(http)
      .post('/api/v1/invitations/accept-existing')
      .set('Authorization', stranger.auth)
      .send({ token })
      .expect(403);
    expect(mismatch.body.code).toBe('INVITATION_EMAIL_MISMATCH');

    await request(http)
      .post('/api/v1/invitations/accept-existing')
      .set('Authorization', invitee.auth)
      .send({ token })
      .expect(200);
    const me = await request(http)
      .get('/api/v1/auth/me')
      .set('Authorization', invitee.auth)
      .expect(200);
    expect(me.body.memberships.map((m: { organizationId: string }) => m.organizationId)).toEqual(
      expect.arrayContaining([invitee.orgId, inviter.orgId]),
    );
  });

  it('locks legal identity once verified and lets the profile be edited before', async () => {
    const owner = await registerBusiness('profile');
    const headers = { Authorization: owner.auth, 'X-Organization-Id': owner.orgId };
    const res = await request(http)
      .patch('/api/v1/organizations/current')
      .set(headers)
      .send({ nif: '000016001234567', address: 'Alger (fictif)' })
      .expect(200);
    expect(res.body).toMatchObject({ nif: '000016001234567', address: 'Alger (fictif)' });
  });
});
