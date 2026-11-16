import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from '../src/health/health.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('GET /api/v1/health', () => {
  let app: INestApplication;
  const prismaMock = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        HealthModule,
      ],
    })
      // The real PrismaService is replaced, so this test needs no database.
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 when the database answers', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('returns 503 when the database is down', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await request(app.getHttpServer()).get('/api/v1/health').expect(503);
  });
  it('answers liveness without touching the database', async () => {
    prismaMock.$queryRaw.mockClear();
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
