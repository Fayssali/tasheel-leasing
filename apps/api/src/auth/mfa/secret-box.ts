import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for TOTP secrets at rest (Phase 0 specification, section 9.3:
 * sensitive columns encrypted at the application level). A database dump alone does not
 * reveal the secrets; the key lives in the secret store (MFA_ENCRYPTION_KEY, 32 bytes, base64).
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version prefix allows key
 * rotation later (v2 with a new key, re-encrypt on next use).
 */
const VERSION = 'v1';

export function parseKey(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new Error('MFA_ENCRYPTION_KEY is not set');
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext)
    throw new Error('Unsupported sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
