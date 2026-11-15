import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh token format: `<userId>.<sessionId>.<secret>`.
 * The user id lets the server set the RLS user context before looking the session up
 * (sessions are only visible to their owner). Only the SHA-256 of the secret is stored,
 * so a database leak does not reveal usable tokens. A forged user id just finds nothing.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REFRESH_RE = new RegExp(`^(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`, 'i');

export interface ParsedRefreshToken {
  userId: string;
  sessionId: string;
  secret: string;
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url'); // 43 characters
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function formatRefreshToken(userId: string, sessionId: string, secret: string): string {
  return `${userId}.${sessionId}.${secret}`;
}

export function parseRefreshToken(raw: unknown): ParsedRefreshToken | null {
  if (typeof raw !== 'string') return null;
  const m = REFRESH_RE.exec(raw);
  if (!m) return null;
  return { userId: m[1]!.toLowerCase(), sessionId: m[2]!.toLowerCase(), secret: m[3]! };
}

/** Constant-time comparison of two hex digests. */
export function digestEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}
