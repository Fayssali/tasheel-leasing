import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CatalogueService } from '../src/marketplace/catalogue.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Storage } from '../src/storage/storage';

const USER = '0193a1b2-0000-7000-8000-000000000001';
const ORG = '0193a1b2-0000-7000-8000-0000000000aa';
const LISTING = '0193a1b2-0000-7000-8000-0000000000e1';

describe('Marketplace HTTP boundaries', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const prisma = { forTenant: jest.fn(), $queryRaw: jest.fn(), $disconnect: jest.fn() };
  const catalogue = {
    search: jest.fn(),
    categories: jest.fn(),
    detail: jest.fn(),
    supplier: jest.fn(),
    file: jest.fn(),
  };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CatalogueService)
      .useValue(catalogue)
      .overrideProvider(Storage)
      .useValue(storage)
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const auth = async () => ({
    Authorization: `Bearer ${await jwt.signAsync({ sub: USER, sid: 's' })}`,
    'X-Organization-Id': ORG,
  });
  const member = (type: string, permissions: string[], status = 'VERIFIED') => ({
    user: { mfaEnabled: true },
    organization: { type, status, deletedAt: null },
    roles: [{ role: { permissions: permissions.map((permissionCode) => ({ permissionCode })) } }],
  });

  it('lets anonymous visitors search with validated filters', async () => {
    catalogue.search.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 24 });
    await request(app.getHttpServer())
      .get('/api/v1/marketplace/listings')
      .query({ q: 'pelle', category: 'construction', sort: 'price_asc' })
      .expect(200);
    expect(catalogue.search.mock.calls[0][0]).toMatchObject({
      q: 'pelle',
      category: 'construction',
      sort: 'price_asc',
    });
    await request(app.getHttpServer())
      .get('/api/v1/marketplace/listings')
      .query({ minPrice: '1e9' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/marketplace/listings')
      .query({ pageSize: 500 })
      .expect(400);
  });

  it('answers 404 for malformed references without touching the database', async () => {
    await request(app.getHttpServer()).get('/api/v1/marketplace/listings/../../etc').expect(404);
    await request(app.getHttpServer()).get('/api/v1/marketplace/listings/EQ-26-1').expect(404);
    expect(catalogue.detail).not.toHaveBeenCalled();
  });

  it('keeps businesses out of the supplier catalogue and suppliers out of buyer quotations', async () => {
    prisma.forTenant.mockResolvedValueOnce(
      member('BUSINESS', ['quotation.request', 'favourite.manage']),
    );
    await request(app.getHttpServer())
      .get('/api/v1/supplier/listings')
      .set(await auth())
      .expect(403);
    prisma.forTenant.mockResolvedValueOnce(
      member('SUPPLIER', ['listing.manage', 'quotation.respond']),
    );
    await request(app.getHttpServer())
      .post('/api/v1/quotation-requests')
      .set(await auth())
      .send({ listingId: LISTING, quantity: 1 })
      .expect(403);
  });

  it('refuses a non-image upload before storing anything', async () => {
    prisma.forTenant.mockResolvedValueOnce(member('SUPPLIER', ['listing.manage']));
    const res = await request(app.getHttpServer())
      .post(`/api/v1/supplier/listings/${LISTING}/images`)
      .set(await auth())
      .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('validates quotation lines and amounts', async () => {
    prisma.forTenant.mockResolvedValueOnce(member('SUPPLIER', ['quotation.respond']));
    await request(app.getHttpServer())
      .post(`/api/v1/supplier/quotation-requests/${LISTING}/quotations`)
      .set(await auth())
      .send({
        lines: [{ label: 'Pelle', quantity: 1, unitPrice: '12.345' }],
        vatRate: '19',
        validUntil: '2030-01-01',
      })
      .expect(400);
  });
});
