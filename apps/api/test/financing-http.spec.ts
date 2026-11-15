import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Scanner } from '../src/storage/scanner';
import { Storage } from '../src/storage/storage';

const USER = '0193a1b2-0000-7000-8000-000000000001';
const ORG = '0193a1b2-0000-7000-8000-0000000000aa';
const ID = '0193a1b2-0000-7000-8000-0000000000e1';

describe('Financing and documents HTTP boundaries', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const prisma = { forTenant: jest.fn(), $queryRaw: jest.fn(), $disconnect: jest.fn() };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
  const scanner = { scan: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(Storage)
      .useValue(storage)
      .overrideProvider(Scanner)
      .useValue(scanner)
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
  beforeEach(() => jest.resetAllMocks());

  const auth = async () => ({
    Authorization: `Bearer ${await jwt.signAsync({ sub: USER, sid: 's' })}`,
    'X-Organization-Id': ORG,
  });
  const member = (type: string, permissions: string[]) => ({
    user: { mfaEnabled: true },
    organization: { type, status: 'VERIFIED', deletedAt: null },
    roles: [{ role: { permissions: permissions.map((permissionCode) => ({ permissionCode })) } }],
  });
  const validOffer = {
    financedAmount: '18000000',
    downPayment: '2000000',
    durationMonths: 48,
    ratePct: '8.5',
    residualValue: '0',
    feesAmount: '0',
    validUntil: '2030-01-01',
  };

  it('keeps businesses out of the institution inbox and institutions out of business applications', async () => {
    prisma.forTenant.mockResolvedValueOnce(
      member('BUSINESS', ['application.manage', 'document.manage']),
    );
    await request(app.getHttpServer())
      .get('/api/v1/institution/applications')
      .set(await auth())
      .expect(403);
    prisma.forTenant.mockResolvedValueOnce(
      member('FINANCIAL_INSTITUTION', ['application.review', 'offer.issue', 'product.manage']),
    );
    await request(app.getHttpServer())
      .get('/api/v1/applications')
      .set(await auth())
      .expect(403);
  });

  it('lets a credit analyst review but not issue offers', async () => {
    prisma.forTenant.mockResolvedValueOnce(member('FINANCIAL_INSTITUTION', ['application.review']));
    const res = await request(app.getHttpServer())
      .post(`/api/v1/institution/applications/${ID}/offers`)
      .set(await auth())
      .send(validOffer)
      .expect(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('validates offer terms: rate format, money format, duration', async () => {
    for (const bad of [
      { ratePct: '8,5' },
      { financedAmount: '1e7' },
      { durationMonths: 0 },
      { durationMonths: 500 },
    ]) {
      prisma.forTenant.mockResolvedValueOnce(
        member('FINANCIAL_INSTITUTION', ['application.review', 'offer.issue']),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/institution/applications/${ID}/offers`)
        .set(await auth())
        .send({ ...validOffer, ...bad })
        .expect(400);
    }
  });

  it('refuses a disguised executable before scanning or storing it', async () => {
    prisma.forTenant.mockResolvedValueOnce(member('BUSINESS', ['document.manage']));
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set(await auth())
      .field('typeCode', 'rc_extract')
      .attach('file', Buffer.from('MZ\x90\x00\x03 not a pdf'), {
        filename: 'extrait.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('requires a reviewing permission to download a document', async () => {
    prisma.forTenant.mockResolvedValueOnce(member('SUPPLIER', ['listing.manage']));
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${ID}/file`)
      .set(await auth())
      .expect(403);
  });

  it('keeps document review to Tasheel staff', async () => {
    prisma.forTenant.mockResolvedValueOnce(
      member('FINANCIAL_INSTITUTION', ['application.review', 'document.manage']),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/admin/documents/${ID}/accept`)
      .set(await auth())
      .expect(403);
  });
});
