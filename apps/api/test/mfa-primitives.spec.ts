import { randomBytes } from 'node:crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
} from '../src/auth/mfa/recovery-codes';
import { open, parseKey, seal } from '../src/auth/mfa/secret-box';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  timeStep,
  verifyTotp,
} from '../src/auth/mfa/totp';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890", 8-digit values.
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(hotp(RFC_SEED, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('round-trips base32 (RFC 4648 test strings)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and ±1 step of drift, rejects older ones', () => {
    const secret = base32Encode(RFC_SEED);
    const now = new Date(1_234_567_890_000);
    const step = timeStep(now);
    const code = (s: number) => hotp(RFC_SEED, s);
    expect(verifyTotp(secret, code(step), now, null)).toBe(step);
    expect(verifyTotp(secret, code(step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, code(step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, code(step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
  });

  it('refuses to replay a code already used', () => {
    const secret = base32Encode(RFC_SEED);
    const now = new Date(1_234_567_890_000);
    const step = timeStep(now);
    expect(verifyTotp(secret, hotp(RFC_SEED, step), now, step)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_SEED, step + 1), now, step)).toBe(step + 1);
  });

  it('builds an otpauth URI authenticator apps can read', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'amel@example.dz');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Tasheel%20Leasing%3Aamel%40example\.dz\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Tasheel+Leasing');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = randomBytes(32);

  it('encrypts with a random IV and decrypts', () => {
    const a = seal('JBSWY3DPEHPK3PXP', key);
    const b = seal('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering and wrong keys', () => {
    const sealed = seal('secret', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(parts.join('.'), key)).toThrow();
    expect(() => open(sealed, randomBytes(32))).toThrow();
  });

  it('validates the key', () => {
    expect(() => parseKey(undefined)).toThrow(/not set/);
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseKey(key.toString('base64')).equals(key)).toBe(true);
  });
});

describe('recovery codes', () => {
  it('generates 10 unique, readable codes and hashes them case- and dash-insensitively', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/));
    expect(hashRecoveryCode('ABCD-EFGH')).toBe(hashRecoveryCode('abcdefgh'));
    expect(looksLikeRecoveryCode('abcd-efgh')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
