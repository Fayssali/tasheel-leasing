/**
 * Financing journey on a real, migrated and seeded PostgreSQL with RLS:
 * documents → application from an accepted quotation → indicative matching → submission to two
 * banks → information request and reply → offer → acceptance. Storage is in memory; antivirus
 * scanning is disabled (SCAN_MODE unset), so documents are marked NOT_SCANNED.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@tasheel/db';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Mailer, type OutgoingMail } from '../src/mail/mailer';
import { Storage } from '../src/storage/storage';

const run = randomUUID().slice(0, 8);
const password = 'integration-test-password';
const files = new Map<string, Buffer>();
const outbox: OutgoingMail[] = [];
const PDF = Buffer.from('%PDF-1.7\n% integration test document\n');

describe('Financing (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer)
      .useValue({ send: async (m: OutgoingMail) => void outbox.push(m) })
      .overrideProvider(Storage)
      .useValue({
        put: async (key: string, body: Buffer) => void files.set(key, body),
        get: async (key: string) => ({
          body: Readable.from(files.get(key)!),
          contentType: 'application/pdf',
        }),
        delete: async (key: string) => void files.delete(key),
      })
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

  async function verifiedOrg(
    label: string,
    organizationType: 'SUPPLIER' | 'BUSINESS' | 'FINANCIAL_INSTITUTION',
  ) {
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
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
    // Institutions must have 2FA; enable it directly for the test user.
    if (organizationType === 'FINANCIAL_INSTITUTION')
      await adminDb.user.update({ where: { email }, data: { mfaEnabled: true } });
    return {
      headers: { Authorization: bearer, 'X-Organization-Id': orgId },
      orgId,
      userId: me.body.user.id as string,
      legalName: `${label} ${run} (fictif)`,
    };
  }

  /** An accepted quotation for the business, created directly (the marketplace flow has its own test). */
  async function acceptedQuotation(
    business: { orgId: string; userId: string },
    supplier: { orgId: string; userId: string },
    total: string,
  ) {
    const category = await adminDb.equipmentCategory.findFirstOrThrow({
      where: { code: 'construction' },
    });
    const listing = await adminDb.equipmentListing.create({
      data: {
        organizationId: supplier.orgId,
        reference: `INT-EQ-${run}`,
        categoryId: category.id,
        title: { fr: `Pelle ${run}` },
        status: 'PUBLISHED',
        price: total,
        createdById: supplier.userId,
      },
    });
    const req = await adminDb.quotationRequest.create({
      data: {
        organizationId: business.orgId,
        supplierOrgId: supplier.orgId,
        reference: `INT-QR-${run}`,
        listingId: listing.id,
        requestedById: business.userId,
        status: 'CLOSED',
      },
    });
    return adminDb.quotation.create({
      data: {
        organizationId: supplier.orgId,
        businessOrgId: business.orgId,
        requestId: req.id,
        listingId: listing.id,
        reference: `INT-QT-${run}`,
        issuedById: supplier.userId,
        lines: [],
        subtotal: total,
        vatAmount: '0',
        total,
        validUntil: new Date(Date.now() + 10 * 86_400_000),
        status: 'ACCEPTED',
      },
    });
  }

  it('runs documents → application → submission → info request → offer → acceptance', async () => {
    const business = await verifiedOrg('borrower', 'BUSINESS');
    const supplier = await verifiedOrg('vendor', 'SUPPLIER');
    const bankA = await verifiedOrg('banka', 'FINANCIAL_INSTITUTION');
    const bankB = await verifiedOrg('bankb', 'FINANCIAL_INSTITUTION');
    const bankC = await verifiedOrg('bankc', 'FINANCIAL_INSTITUTION');
    const quotation = await acceptedQuotation(business, supplier, '20000000.00');

    // Banks publish products (their own criteria and indicative rates).
    const product = (overrides: object) => ({
      name: { fr: `Crédit-bail ${run}` },
      productType: 'LEASING',
      minAmount: '1000000',
      maxAmount: '100000000',
      minDurationMonths: 12,
      maxDurationMonths: 60,
      minDownPaymentPct: '10',
      categoryCodes: [],
      wilayaCodes: [],
      minYearsInBusiness: 0,
      indicativeRateMin: '7',
      indicativeRateMax: '9',
      requiredDocumentTypes: [],
      isActive: true,
      ...overrides,
    });
    const pA = await request(http)
      .post('/api/v1/institution/products')
      .set(bankA.headers)
      .send(product({}))
      .expect(201);
    const pB = await request(http)
      .post('/api/v1/institution/products')
      .set(bankB.headers)
      .send(product({ productType: 'IJARA', requiredDocumentTypes: ['bank_statements'] }))
      .expect(201);

    // Business documents: the platform requires tax, CNAS and financial statements for any application.
    const upload = async (typeCode: string) =>
      (
        await request(http)
          .post('/api/v1/documents')
          .set(business.headers)
          .field('typeCode', typeCode)
          .attach('file', PDF, `${typeCode}.pdf`)
          .expect(201)
      ).body.id as string;
    const docs = await Promise.all(
      ['tax_clearance', 'cnas_clearance', 'financial_statements'].map(upload),
    );
    const vault = await request(http).get('/api/v1/documents').set(business.headers).expect(200);
    expect(
      vault.body.checklist.application.every((c: { state: string }) => c.state === 'PENDING'),
    ).toBe(true);
    const privateDoc = await upload('articles_of_association'); // never attached

    // Application from the accepted quotation.
    const eligible = await request(http)
      .get('/api/v1/applications/eligible-quotations')
      .set(business.headers)
      .expect(200);
    expect(eligible.body.map((q: { id: string }) => q.id)).toContain(quotation.id);
    const created = await request(http)
      .post('/api/v1/applications')
      .set(business.headers)
      .send({
        quotationId: quotation.id,
        downPayment: '2000000',
        durationMonths: 48,
        purpose: 'Chantier',
        companyProfile: { yearsInBusiness: 6, employees: 40 },
      })
      .expect(201);
    const appId = created.body.id as string;
    await request(http)
      .post(`/api/v1/applications/${appId}/documents`)
      .set(business.headers)
      .send({ documentIds: docs })
      .expect(200);

    const matches = await request(http)
      .get(`/api/v1/applications/${appId}/matches`)
      .set(business.headers)
      .expect(200);
    const mine = matches.body.filter((m: { productId: string }) =>
      [pA.body.id, pB.body.id].includes(m.productId),
    );
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ indicative: true, score: 100 });

    // Bank B requires bank statements: submission lists what is missing.
    const missing = await request(http)
      .post(`/api/v1/applications/${appId}/submit`)
      .set(business.headers)
      .send({ productIds: [pA.body.id, pB.body.id] })
      .expect(400);
    expect(missing.body).toMatchObject({ code: 'MISSING_DOCUMENTS', missing: ['bank_statements'] });
    await request(http)
      .post(`/api/v1/applications/${appId}/documents`)
      .set(business.headers)
      .send({ documentIds: [await upload('bank_statements')] })
      .expect(200);
    await request(http)
      .post(`/api/v1/applications/${appId}/submit`)
      .set(business.headers)
      .send({ productIds: [pA.body.id, pB.body.id] })
      .expect(200);

    // Bank A sees the application and its attachments; bank C sees nothing.
    const inboxA = await request(http)
      .get('/api/v1/institution/applications')
      .set(bankA.headers)
      .expect(200);
    expect(inboxA.body).toHaveLength(1);
    const submissionA = inboxA.body[0].id as string;
    expect(inboxA.body[0].application.businessSnapshot.legalName).toBe(business.legalName);
    const detail = await request(http)
      .get(`/api/v1/institution/applications/${submissionA}`)
      .set(bankA.headers)
      .expect(200);
    expect(detail.body.status).toBe('UNDER_REVIEW');
    expect(detail.body.application.documents).toHaveLength(4);
    await request(http).get(`/api/v1/documents/${docs[0]}/file`).set(bankA.headers).expect(200);
    await request(http).get(`/api/v1/documents/${privateDoc}/file`).set(bankA.headers).expect(404);
    expect(
      (await request(http).get('/api/v1/institution/applications').set(bankC.headers).expect(200))
        .body,
    ).toHaveLength(0);
    await request(http)
      .get(`/api/v1/institution/applications/${submissionA}`)
      .set(bankC.headers)
      .expect(404);
    await request(http).get(`/api/v1/documents/${docs[0]}/file`).set(bankC.headers).expect(404);

    // Information request and reply.
    await request(http)
      .post(`/api/v1/institution/applications/${submissionA}/request-info`)
      .set(bankA.headers)
      .send({ note: 'Merci de préciser le planning de livraison.' })
      .expect(200);
    await request(http)
      .post(`/api/v1/applications/submissions/${submissionA}/reply`)
      .set(business.headers)
      .send({ note: 'Livraison prévue en mars.' })
      .expect(200);

    // Offers from both banks; the business accepts bank A's.
    const validUntil = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const offerA = await request(http)
      .post(`/api/v1/institution/applications/${submissionA}/offers`)
      .set(bankA.headers)
      .send({
        productId: pA.body.id,
        financedAmount: '18000000',
        downPayment: '2000000',
        durationMonths: 48,
        ratePct: '8.5',
        residualValue: '0',
        feesAmount: '90000',
        validUntil,
        conditions: 'Sous réserve du contrat.',
      })
      .expect(201);
    expect(offerA.body).toMatchObject({ installment: '443669.46', totalCost: '23386134.08' });
    const submissionB = (
      await request(http).get('/api/v1/institution/applications').set(bankB.headers).expect(200)
    ).body[0].id as string;
    await request(http)
      .post(`/api/v1/institution/applications/${submissionB}/offers`)
      .set(bankB.headers)
      .send({
        financedAmount: '18000000',
        downPayment: '2000000',
        durationMonths: 48,
        ratePct: '9',
        residualValue: '0',
        feesAmount: '0',
        validUntil,
      })
      .expect(201);

    const view = await request(http)
      .get(`/api/v1/applications/${appId}`)
      .set(business.headers)
      .expect(200);
    expect(view.body.offers).toHaveLength(2);
    expect(
      view.body.submissions.map((s: { institutionName: string }) => s.institutionName).sort(),
    ).toEqual([bankA.legalName, bankB.legalName].sort());
    await request(http)
      .post(`/api/v1/applications/offers/${offerA.body.id}/accept`)
      .set(business.headers)
      .expect(200);

    const after = await request(http)
      .get(`/api/v1/applications/${appId}`)
      .set(business.headers)
      .expect(200);
    expect(after.body.status).toBe('OFFER_ACCEPTED');
    expect(after.body.offers.map((o: { status: string }) => o.status).sort()).toEqual([
      'ACCEPTED',
      'DECLINED',
    ]);
    const inboxB = await request(http)
      .get('/api/v1/institution/applications')
      .set(bankB.headers)
      .expect(200);
    expect(inboxB.body[0].status).toBe('CLOSED');

    await new Promise((r) => setTimeout(r, 50));
    expect(outbox.some((m) => /Nouvelle demande de financement/.test(m.subject))).toBe(true);
    expect(outbox.some((m) => /Proposition de financement/.test(m.subject))).toBe(true);
    expect(outbox.some((m) => /Proposition acceptée/.test(m.subject))).toBe(true);
  });
});
