/** Fails fast at startup when required configuration is missing or unsafe. */
const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;
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

  return { ...env, API_PORT: Number(env.API_PORT ?? 3000) };
}
