import { validateEnv } from '../src/config/env';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://tasheel_app:Zx81-long-random@db:5432/tasheel',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SCAN_MODE: 'clamav',
  CLAMAV_HOST: 'clamav',
  WEB_APP_URL: 'https://app.example.dz',
  API_CORS_ORIGIN: 'https://app.example.dz',
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET_DOCUMENTS: 'tasheel-documents',
  S3_ACCESS_KEY: 'tasheel',
  S3_SECRET_KEY: 'another-long-random-value',
  SMTP_HOST: 'smtp.example.dz',
  MAIL_FROM: 'Tasheel <no-reply@example.dz>',
  TRUST_PROXY: '1',
};

describe('validateEnv', () => {
  it('accepts a complete production configuration', () => {
    expect(validateEnv(PROD)).toMatchObject({ API_PORT: 3000 });
  });

  it('lets development run with the example file', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'change-me-access' }),
    ).not.toThrow();
  });

  it.each([
    [{ JWT_ACCESS_SECRET: 'change-me-access' }, /JWT_ACCESS_SECRET/],
    [{ MFA_ENCRYPTION_KEY: 'ZGV2LW9ubHktbWZhLWtleS1jaGFuZ2UtbWUtMzJieXQ=' }, /MFA_ENCRYPTION_KEY/],
    [{ SCAN_MODE: 'off' }, /SCAN_MODE/],
    [{ WEB_APP_URL: 'http://app.example.dz' }, /WEB_APP_URL must be an https/],
    [{ DATABASE_URL: 'postgresql://tasheel_app:tasheel_app_dev@db/tasheel' }, /DATABASE_URL still/],
    [{ S3_SECRET_KEY: 'tasheel_minio_dev' }, /S3_SECRET_KEY still/],
    [{ SMTP_HOST: undefined }, /missing SMTP_HOST/],
    [{ TRUST_PROXY: 'true' }, /TRUST_PROXY/],
  ])('refuses an unsafe production value (%o)', (override, message) => {
    expect(() => validateEnv({ ...PROD, ...override })).toThrow(message);
  });
});
