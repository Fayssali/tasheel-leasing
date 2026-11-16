/** Fails fast at startup when required configuration is missing or unsafe. */
const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;

/** Values shipped in .env.example. Any of them in production means a copied development file. */
const DEV_MFA_KEY = 'ZGV2LW9ubHktbWZhLWtleS1jaGFuZ2UtbWUtMzJieXQ=';
const PLACEHOLDER_SECRETS = new Set(['change-me-access', 'change-me-refresh']);
const DEV_PASSWORDS = ['tasheel_app_dev', 'tasheel_admin_dev', 'tasheel_minio_dev', 'postgres_dev'];

/** Required in production only: without them links, uploads or emails silently break. */
const REQUIRED_IN_PRODUCTION = [
  'WEB_APP_URL',
  'API_CORS_ORIGIN',
  'S3_ENDPOINT',
  'S3_BUCKET_DOCUMENTS',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'SMTP_HOST',
  'MAIL_FROM',
  'CLAMAV_HOST',
] as const;

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (env.NODE_ENV === 'production') checkProduction(env);

  return { ...env, API_PORT: Number(env.API_PORT ?? 3000) };
}

function checkProduction(env: Record<string, unknown>): void {
  const errors: string[] = [];
  const value = (key: string) => String(env[key] ?? '');

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !env[key]);
  if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`);

  const secret = value('JWT_ACCESS_SECRET');
  if (secret.length < 32 || PLACEHOLDER_SECRETS.has(secret)) {
    errors.push('JWT_ACCESS_SECRET must be a random value of at least 32 characters');
  }

  const key = Buffer.from(value('MFA_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32 || value('MFA_ENCRYPTION_KEY') === DEV_MFA_KEY) {
    errors.push('MFA_ENCRYPTION_KEY must be a production key of 32 random bytes (base64)');
  }

  if (env.SCAN_MODE !== 'clamav') {
    errors.push('SCAN_MODE must be "clamav": uploaded documents are always scanned');
  }

  for (const k of ['WEB_APP_URL', 'API_CORS_ORIGIN']) {
    if (env[k] && !value(k).startsWith('https://')) errors.push(`${k} must be an https:// URL`);
  }

  for (const k of ['DATABASE_URL', 'S3_SECRET_KEY']) {
    if (DEV_PASSWORDS.some((p) => value(k).includes(p))) {
      errors.push(`${k} still uses a development password from .env.example`);
    }
  }

  if (env.TRUST_PROXY !== undefined && !/^\d+$/.test(value('TRUST_PROXY'))) {
    errors.push('TRUST_PROXY must be the number of reverse proxies in front of the API');
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe production configuration:\n- ${errors.join('\n- ')}`);
  }
}
