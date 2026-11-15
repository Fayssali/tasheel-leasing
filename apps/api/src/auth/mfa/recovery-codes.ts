import { randomInt } from 'node:crypto';
import { sha256 } from '../tokens';

/**
 * One-time recovery codes for a lost phone. Shown once at enrolment; only SHA-256 hashes
 * are stored. Alphabet without look-alike characters (no 0/o, 1/l/i).
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return Array.from({ length: count }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return sha256(`recovery:${normalizeRecoveryCode(code)}`);
}

export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === 8 && !/^\d+$/.test(code.trim());
}
