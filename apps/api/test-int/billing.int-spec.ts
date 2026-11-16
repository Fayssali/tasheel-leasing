/**
 * Billing on a real, migrated and seeded PostgreSQL with RLS: rule → accepted quotation accrues
 * the supplier commission in the same transaction → draft → issue (gapless number) → payer
 * reads it, others do not → payment → credit note.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@tasheel/db';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { Mailer, type OutgoingMail } from '../src/mail/mailer';

const run = randomUUID().slice(0, 8);
const password = 'integration-test-password';
const outbox: OutgoingMail[] = [];
const todayIso = new Date().toISOString().slice(0, 10);

describe('Billing (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });

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

  afterAll(async () => {
    await adminDb.$disconnect();
    await app.close();
  });

  async function verifiedOrg(label: string, organizationType: 'SUPPLIER' | 'BUSINESS') {
    const email = `${label}-${run}@int-test.local`;
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({
        organizationType,
        legalName: `${label} ${run} (fictif)`,
        email,
        password,
        firstName: label,
        lastName: 'Test',
        wilayaCode: '16',
        acceptTerms: true,
      })
      .expect(201);
    const bearer = `Bearer ${res.body.accessToken}`;
    const me = await request(http).get('/api/v1/auth/me').set('Authorization', bearer).expect(200);
    const orgId = me.body.memberships[0].organizationId as string;
    await adminDb.organization.update({
      where: { id: orgId },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        nif: `0000160000${run.slice(0, 5)}`,
        rcNumber: `16/00-${run.slice(0, 7)}B26`,
      },
    });
    return {
      headers: { Authorization: bearer, 'X-Organization-Id': orgId },
      orgId,
      userId: me.body.user.id as string,
    };
  }

  async function staff() {
    const platform =
      (await adminDb.organization.findFirst({ where: { type: 'PLATFORM' } })) ??
      (await adminDb.organization.create({
        data: { type: 'PLATFORM', legalName: 'Tasheel (test)', status: 'VERIFIED' },
      }));
    const role = await adminDb.role.findFirstOrThrow({
      where: { organizationId: null, code: 'platform_super_admin' },
    });
    const email = `billing-${run}@int-test.local`;
    const user = await adminDb.user.create({
      data: {
        email,
        firstName: 'Billing',
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
    // Staff need 2FA; it is switched on directly after sign-in (the MFA flow has its own test).
    await adminDb.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    return { Authorization: `Bearer ${login.body.accessToken}`, 'X-Organization-Id': platform.id };
  }

  it('accrues, invoices, collects and credits a supplier commission', async () => {
    const supplier = await verifiedOrg('payer', 'SUPPLIER');
    const other = await verifiedOrg('bystander', 'SUPPLIER');
    const business = await verifiedOrg('client', 'BUSINESS');
    const admin = await staff();

    // Billing settings and a rule specific to this supplier (2 %, minimum 5 000).
    await request(http)
      .put('/api/v1/admin/billing/settings')
      .set(admin)
      .send({
        issuer: {
          legalName: 'Tasheel SPA (fictif)',
          address: '1 rue Exemple, Alger',
          wilayaCode: '16',
          rcNumber: '16/00-0000000B26',
          nif: '000016000000000',
          nis: '000016000000000',
          articleImposition: '16000000000',
        },
        vatRate: '19',
        paymentTermsDays: 30,
        invoicePrefix: 'TSL',
        creditNotePrefix: 'AV',
      })
      .expect(200);
    await request(http)
      .post('/api/v1/admin/billing/rules')
      .set(admin)
      .send({
        name: { fr: `Contrat ${run}` },
        trigger: 'QUOTATION_ACCEPTED',
        payerOrgId: supplier.orgId,
        basis: 'PERCENT',
        ratePct: '2',
        minAmount: '5000',
        categoryCodes: [],
        validFrom: todayIso,
        isActive: true,
      })
      .expect(201);
    const rules = await request(http)
      .get('/api/v1/billing/rules')
      .set(supplier.headers)
      .expect(200);
    expect(rules.body.some((r: { name: { fr: string } }) => r.name.fr === `Contrat ${run}`)).toBe(
      true,
    );
    const otherRules = await request(http)
      .get('/api/v1/billing/rules')
      .set(other.headers)
      .expect(200);
    expect(
      otherRules.body.some((r: { name: { fr: string } }) => r.name.fr === `Contrat ${run}`),
    ).toBe(false);

    // An issued quotation, accepted by the business through the API.
    const category = await adminDb.equipmentCategory.findFirstOrThrow({
      where: { code: 'construction' },
    });
    const listing = await adminDb.equipmentListing.create({
      data: {
        organizationId: supplier.orgId,
        reference: `BIL-EQ-${run}`,
        categoryId: category.id,
        title: { fr: `Pelle ${run}` },
        status: 'PUBLISHED',
        createdById: supplier.userId,
      },
    });
    const req = await adminDb.quotationRequest.create({
      data: {
        organizationId: business.orgId,
        supplierOrgId: supplier.orgId,
        reference: `BIL-QR-${run}`,
        listingId: listing.id,
        requestedById: business.userId,
        status: 'QUOTED',
      },
    });
    const quotation = await adminDb.quotation.create({
      data: {
        organizationId: supplier.orgId,
        businessOrgId: business.orgId,
        requestId: req.id,
        listingId: listing.id,
        reference: `BIL-QT-${run}`,
        issuedById: supplier.userId,
        lines: [],
        subtotal: '1512555.50',
        vatRate: '19',
        vatAmount: '287385.55',
        total: '1799941.05',
        validUntil: new Date(Date.now() + 10 * 86_400_000),
      },
    });
    await request(http)
      .post(`/api/v1/quotation-requests/quotations/${quotation.id}/accept`)
      .set(business.headers)
      .expect(200);

    const commissions = await request(http)
      .get('/api/v1/billing/commissions')
      .set(supplier.headers)
      .expect(200);
    expect(commissions.body).toHaveLength(1);
    expect(commissions.body[0]).toMatchObject({
      sourceReference: `BIL-QT-${run}`,
      amount: '30251.11',
      status: 'ACCRUED',
    }); // 2 % of 1 512 555.50
    expect(
      (await request(http).get('/api/v1/billing/commissions').set(other.headers).expect(200)).body,
    ).toHaveLength(0);
    await request(http).get('/api/v1/billing/commissions').set(business.headers).expect(403);

    // Draft, issue, read.
    await request(http)
      .post('/api/v1/admin/billing/invoices/generate')
      .set(admin)
      .send({ periodEnd: todayIso })
      .expect(200);
    const drafts = await request(http)
      .get('/api/v1/admin/billing/invoices')
      .query({ status: 'DRAFT', organizationId: supplier.orgId })
      .set(admin)
      .expect(200);
    expect(drafts.body).toHaveLength(1);
    expect(
      (await request(http).get('/api/v1/billing/invoices').set(supplier.headers).expect(200)).body,
    ).toHaveLength(0); // drafts are internal
    const issued = await request(http)
      .post(`/api/v1/admin/billing/invoices/${drafts.body[0].id}/issue`)
      .set(admin)
      .expect(200);
    expect(issued.body).toMatchObject({
      subtotal: '30251.11',
      vatAmount: '5747.71',
      total: '35998.82',
    });
    expect(issued.body.number).toMatch(/^TSL-\d{4}-\d{6}$/);

    const mine = await request(http)
      .get('/api/v1/billing/invoices')
      .set(supplier.headers)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    const detail = await request(http)
      .get(`/api/v1/billing/invoices/${drafts.body[0].id}`)
      .set(supplier.headers)
      .expect(200);
    expect(detail.body.issuer.legalName).toBe('Tasheel SPA (fictif)');
    expect(detail.body.lines).toHaveLength(1);
    await request(http)
      .get(`/api/v1/billing/invoices/${drafts.body[0].id}`)
      .set(other.headers)
      .expect(404);

    // Paid, then credited.
    await request(http)
      .post(`/api/v1/admin/billing/invoices/${drafts.body[0].id}/paid`)
      .set(admin)
      .send({ paidOn: todayIso, reference: `VIR-${run}` })
      .expect(200);
    const credit = await request(http)
      .post(`/api/v1/admin/billing/invoices/${drafts.body[0].id}/credit-note`)
      .set(admin)
      .send({ reason: 'Erreur de base de calcul (test)', releaseCommissions: true })
      .expect(201);
    expect(credit.body).toMatchObject({ total: '-35998.82' });
    expect(credit.body.number).toMatch(/^AV-\d{4}-\d{6}$/);
    const after = await request(http)
      .get('/api/v1/billing/invoices')
      .set(supplier.headers)
      .expect(200);
    expect(
      after.body.map((i: { kind: string; status: string }) => `${i.kind}:${i.status}`).sort(),
    ).toEqual(['CREDIT_NOTE:ISSUED', 'INVOICE:CANCELLED']);
    const released = await request(http)
      .get('/api/v1/billing/commissions')
      .set(supplier.headers)
      .expect(200);
    expect(released.body[0]).toMatchObject({ status: 'ACCRUED', invoiceId: null });

    await new Promise((r) => setTimeout(r, 100));
    expect(outbox.some((m) => /Facture/.test(m.subject))).toBe(true);

    // In-app notifications: the supplier sees the invoice; the bystander sees nothing of it.
    const notes = await request(http)
      .get('/api/v1/notifications')
      .set('Authorization', supplier.headers.Authorization)
      .expect(200);
    expect(notes.body.items.some((n: { key: string }) => n.key === 'email.invoiceIssued')).toBe(
      true,
    );
    expect(notes.body.unread).toBeGreaterThan(0);
    const otherNotes = await request(http)
      .get('/api/v1/notifications')
      .set('Authorization', other.headers.Authorization)
      .expect(200);
    expect(
      otherNotes.body.items.some((n: { key: string }) => n.key === 'email.invoiceIssued'),
    ).toBe(false);
    await request(http)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', supplier.headers.Authorization)
      .expect(200);
    expect(
      (
        await request(http)
          .get('/api/v1/notifications')
          .set('Authorization', supplier.headers.Authorization)
          .expect(200)
      ).body.unread,
    ).toBe(0);

    // Reports: the supplier's own figures; the platform view for Tasheel staff only.
    const report = await request(http)
      .get('/api/v1/reports/overview')
      .set(supplier.headers)
      .expect(200);
    expect(report.body).toMatchObject({
      kind: 'SUPPLIER',
      quotationsAccepted: 1,
      acceptedValue: '1512555.50',
      commissionsAccrued: '30251.11',
    });
    expect(report.body.requestsByMonth).toHaveLength(6);
    await request(http).get('/api/v1/admin/reports').set(supplier.headers).expect(403);
    const platform = await request(http).get('/api/v1/admin/reports').set(admin).expect(200);
    expect(Number(platform.body.collected)).toBeGreaterThanOrEqual(35998.82);
  });
});
