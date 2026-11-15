/** Fails fast at startup when required configuration is missing or unsafe. */
const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;
/** The development key shipped in .env.example; refused in production. */
const DEV_MFA_KEY = 'ZGV2LW9ubHktbWZhLWtleS1jaGFuZ2UtbWUtMzJieXQ=';
const PLACEHOLDER_SECRETS = new Set(['change-me-access', 'change-me-refresh']);

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const secret = String(env.JWT_ACCESS_SECRET);
  if (env.NODE_ENV === 'production' && (secret.length < 32 || PLACEHOLDER_SECRETS.has(secret))) {
    throw new Error(
      'JWT_ACCESS_SECRET must be a random value of at least 32 characters in production',
    );
  }

  if (env.NODE_ENV === 'production') {
    const key = Buffer.from(String(env.MFA_ENCRYPTION_KEY ?? ''), 'base64');
    if (key.length !== 32 || String(env.MFA_ENCRYPTION_KEY) === DEV_MFA_KEY) {
      throw new Error('MFA_ENCRYPTION_KEY must be a production key of 32 random bytes (base64)');
    }
  }

  if (env.NODE_ENV === 'production' && env.SCAN_MODE !== 'clamav') {
    throw new Error(
      'SCAN_MODE must be "clamav" in production: uploaded documents are always scanned',
    );
  }

  return { ...env, API_PORT: Number(env.API_PORT ?? 3000) };
}
