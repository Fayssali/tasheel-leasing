import { hash, verify } from '@node-rs/argon2';

/** Argon2id with OWASP-recommended baseline parameters (19 MiB, 2 iterations). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so a login attempt takes the same time
// whether or not the account exists (prevents account enumeration by timing).
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('tasheel-dummy-password-for-timing');
  await verifyPassword(await dummyHash, plain);
}
