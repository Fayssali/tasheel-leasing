import { isLocked, lockUntilAfterFailure, LOCKOUT_THRESHOLD } from '../src/auth/lockout';
import { hashPassword, verifyPassword } from '../src/auth/password';
import {
  digestEquals,
  formatRefreshToken,
  newSecret,
  parseRefreshToken,
  sha256,
} from '../src/auth/tokens';

const USER = '0193a1b2-0000-7000-8000-000000000001';
const SESSION = '0193a1b2-0000-7000-8000-000000000002';

describe('refresh tokens', () => {
  it('round-trips user id, session id and secret', () => {
    const secret = newSecret();
    expect(parseRefreshToken(formatRefreshToken(USER, SESSION, secret))).toEqual({
      userId: USER,
      sessionId: SESSION,
      secret,
    });
  });

  it('rejects malformed or tampered tokens', () => {
    expect(parseRefreshToken(undefined)).toBeNull();
    expect(parseRefreshToken('')).toBeNull();
    expect(parseRefreshToken(`${USER}.${SESSION}`)).toBeNull();
    expect(parseRefreshToken(`${USER}.${SESSION}.short`)).toBeNull();
    expect(parseRefreshToken(`not-a-uuid.${SESSION}.${newSecret()}`)).toBeNull();
    expect(parseRefreshToken(`${USER}.${SESSION}.${newSecret()}.extra`)).toBeNull();
  });

  it('stores only a digest and compares it in constant time', () => {
    const secret = newSecret();
    expect(sha256(secret)).toHaveLength(64);
    expect(sha256(secret)).not.toContain(secret);
    expect(digestEquals(sha256(secret), sha256(secret))).toBe(true);
    expect(digestEquals(sha256(secret), sha256(newSecret()))).toBe(false);
    expect(digestEquals('', '')).toBe(false);
  });
});

describe('lockout policy', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  const minutesLocked = (failures: number) => {
    const until = lockUntilAfterFailure(failures, now);
    return until ? (until.getTime() - now.getTime()) / 60_000 : null;
  };

  it('does not lock before the threshold', () => {
    for (let n = 1; n < LOCKOUT_THRESHOLD; n++) expect(minutesLocked(n)).toBeNull();
  });

  it('locks 15 min at 5 failures, then doubles, capped at 24 h', () => {
    expect(minutesLocked(5)).toBe(15);
    expect(minutesLocked(6)).toBeNull();
    expect(minutesLocked(10)).toBe(30);
    expect(minutesLocked(15)).toBe(60);
    expect(minutesLocked(100)).toBe(24 * 60);
  });

  it('reports lock state', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLocked(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});

describe('password hashing', () => {
  it('hashes with Argon2id and verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(h, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(h, 'wrong password!!')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
