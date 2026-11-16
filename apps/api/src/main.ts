import 'reflect-metadata';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestLog } from './common/request-log';

export const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // One JSON object per line in production, so a log collector can parse and search it.
    logger: new ConsoleLogger({ json: production, colors: !production }),
  });
  const config = app.get(ConfigService);

  // Behind a reverse proxy, the client address and https come from X-Forwarded-* headers.
  // Trust exactly the configured number of hops, never "any": that would let a client
  // spoof its address and get around the per-address rate limits.
  const hops = Number(config.get<string>('TRUST_PROXY') ?? 0);
  if (hops > 0) app.set('trust proxy', hops);
  app.disable('x-powered-by');

  app.setGlobalPrefix(API_PREFIX);
  app.use(requestLog);
  // The API only serves JSON: deny everything a browser could load from it.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: config.get<string>('API_CORS_ORIGIN'), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT') ?? 3000;
  await app.listen(port);
}

void bootstrap();
