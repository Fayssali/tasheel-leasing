/**
 * Marketplace journey on a real, migrated and seeded PostgreSQL with RLS:
 * supplier publishes → public search finds it → business requests a quotation →
 * supplier answers → business accepts. Storage is an in-memory fake.
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
const files = new Map<string, { body: Buffer; type: string }>();
const outbox: OutgoingMail[] = [];
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

describe('Marketplace (PostgreSQL + RLS)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer)
      .useValue({ send: async (m: OutgoingMail) => void outbox.push(m) })
      .overrideProvider(Storage)
      .useValue({
        put: async (key: string, body: Buffer, type: string) => void files.set(key, { body, type }),
        get: async (key: string) => ({
          body: Readable.from(files.get(key)!.body),
          contentType: files.get(key)!.type,
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
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
    return {
      headers: { Authorization: bearer, 'X-Organization-Id': orgId },
      orgId,
      legalName: `${label} ${run} (fictif)`,
    };
  }

  it('runs publish → search → quotation request → quotation → acceptance', async () => {
    const supplier = await verifiedOrg('seller', 'SUPPLIER');
    const buyer = await verifiedOrg('buyer', 'BUSINESS');
    const other = await verifiedOrg('rival', 'SUPPLIER');

    const categories = await request(http).get('/api/v1/marketplace/categories').expect(200);
    const construction = categories.body.find((c: { code: string }) => c.code === 'construction');
    expect(construction).toBeDefined();

    // Supplier drafts a listing.
    const created = await request(http)
      .post('/api/v1/supplier/listings')
      .set(supplier.headers)
      .send({
        categoryId: construction.id,
        title: { fr: `Pelle hydraulique ${run}`, ar: 'حفارة هيدروليكية' },
        description: { fr: 'Pelle sur chenilles, état neuf.' },
        brand: 'Fictive',
        model: 'PX-200',
        year: 2025,
        condition: 'NEW',
        price: '18500000.00',
        priceOnRequest: false,
        priceIncludesVat: false,
        availability: 'IN_STOCK',
        deliveryWilayas: [],
        specs: { power_kw: 110, fuel: 'diesel' },
      })
      .expect(201);
    const listingId = created.body.id as string;
    expect(created.body.reference).toMatch(/^EQ-\d{4}-\d{6}$/);

    // Not public yet; cannot publish without an image; a rival cannot touch it.
    const before = await request(http)
      .get('/api/v1/marketplace/listings')
      .query({ q: run })
      .expect(200);
    expect(before.body.total).toBe(0);
    await request(http)
      .post(`/api/v1/supplier/listings/${listingId}/submit`)
      .set(supplier.headers)
      .expect(400);
    await request(http)
      .get(`/api/v1/supplier/listings/${listingId}`)
      .set(other.headers)
      .expect(404);

    await request(http)
      .post(`/api/v1/supplier/listings/${listingId}/images`)
      .set(supplier.headers)
      .attach('file', PNG, 'photo.png')
      .expect(201);
    const published = await request(http)
      .post(`/api/v1/supplier/listings/${listingId}/submit`)
      .set(supplier.headers)
      .expect(200);
    expect(published.body.status).toBe('PUBLISHED');

    // Public search (prefix, accent-insensitive) and equipment page.
    const found = await request(http)
      .get('/api/v1/marketplace/listings')
      .query({ q: `hydrauli ${run}`, category: 'construction' })
      .expect(200);
    expect(found.body.total).toBe(1);
    expect(found.body.items[0]).toMatchObject({
      supplierName: supplier.legalName,
      price: '18500000.00',
    });
    const page = await request(http)
      .get(`/api/v1/marketplace/listings/${created.body.reference}`)
      .expect(200);
    expect(page.body.images).toHaveLength(1);
    await request(http)
      .get(`/api/v1/marketplace/images/${page.body.images[0].id}`)
      .expect(200)
      .expect('Content-Type', 'image/png');

    // Business: favourite and quotation request.
    await request(http)
      .post('/api/v1/favourites')
      .set(buyer.headers)
      .send({ listingId })
      .expect(201);
    const favs = await request(http).get('/api/v1/favourites').set(buyer.headers).expect(200);
    expect(favs.body).toHaveLength(1);
    const asked = await request(http)
      .post('/api/v1/quotation-requests')
      .set(buyer.headers)
      .send({ listingId, quantity: 2, message: 'Livraison à Alger' })
      .expect(201);

    // Supplier sees who is asking; the rival sees nothing.
    const inbox = await request(http)
      .get('/api/v1/supplier/quotation-requests')
      .set(supplier.headers)
      .expect(200);
    expect(inbox.body[0]).toMatchObject({
      reference: asked.body.reference,
      businessName: buyer.legalName,
      quantity: 2,
    });
    const rivalInbox = await request(http)
      .get('/api/v1/supplier/quotation-requests')
      .set(other.headers)
      .expect(200);
    expect(rivalInbox.body).toHaveLength(0);

    // Supplier quotes; business accepts.
    const validUntil = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const quote = await request(http)
      .post(`/api/v1/supplier/quotation-requests/${asked.body.id}/quotations`)
      .set(supplier.headers)
      .send({
        lines: [{ label: 'Pelle PX-200', quantity: 2, unitPrice: '18500000.00' }],
        vatRate: '19',
        validUntil,
        deliveryTerms: 'Livraison incluse',
      })
      .expect(201);
    expect(quote.body).toMatchObject({
      subtotal: '37000000.00',
      vatAmount: '7030000.00',
      total: '44030000.00',
    });

    const mine = await request(http)
      .get('/api/v1/quotation-requests')
      .set(buyer.headers)
      .expect(200);
    expect(mine.body[0].quotations[0]).toMatchObject({ status: 'ISSUED', total: '44030000' });
    await request(http)
      .post(`/api/v1/quotation-requests/quotations/${quote.body.id}/accept`)
      .set(buyer.headers)
      .expect(200);
    await request(http)
      .post(`/api/v1/quotation-requests/quotations/${quote.body.id}/accept`)
      .set(buyer.headers)
      .expect(409);

    // Supplier archives the listing: gone from search, still readable in the buyer's history.
    await request(http)
      .post(`/api/v1/supplier/listings/${listingId}/archive`)
      .set(supplier.headers)
      .expect(200);
    const after = await request(http)
      .get('/api/v1/marketplace/listings')
      .query({ q: run })
      .expect(200);
    expect(after.body.total).toBe(0);
    const history = await request(http)
      .get('/api/v1/quotation-requests')
      .set(buyer.headers)
      .expect(200);
    expect(history.body[0].listing.reference).toBe(created.body.reference);

    await new Promise((r) => setTimeout(r, 50));
    expect(outbox.some((m) => /Nouvelle demande de devis/.test(m.subject))).toBe(true);
    expect(outbox.some((m) => /Devis .* accepté/.test(m.subject))).toBe(true);
  });
});
