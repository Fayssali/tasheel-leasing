/** Fails fast at startup when required configuration is missing. */
const REQUIRED = ['DATABASE_URL'] as const;

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return { ...env, API_PORT: Number(env.API_PORT ?? 3000) };
}
