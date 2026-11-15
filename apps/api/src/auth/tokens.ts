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

/**
 * Emailed single-use tokens: `<userId>.<secret>`. As with refresh tokens, the user id lets
 * the server set the RLS user context before the lookup; only SHA-256(secret) is stored.
 */
const USER_TOKEN_RE = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`, 'i');

export interface ParsedUserToken {
  userId: string;
  secret: string;
}

export function formatUserToken(userId: string, secret: string): string {
  return `${userId}.${secret}`;
}

export function parseUserToken(raw: unknown): ParsedUserToken | null {
  if (typeof raw !== 'string') return null;
  const m = USER_TOKEN_RE.exec(raw.trim());
  if (!m) return null;
  return { userId: m[1]!.toLowerCase(), secret: m[2]! };
}

/**
 * Invitation token: `<organizationId>.<invitationId>.<secret>`. The organization id lets the
 * server set the RLS tenant context before looking the invitation up (the invitee is not a
 * member yet). Only SHA-256(secret) is stored; a forged id finds nothing.
 */
const INVITATION_RE = new RegExp(`^(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`, 'i');

export interface ParsedInvitationToken {
  organizationId: string;
  invitationId: string;
  secret: string;
}

export function formatInvitationToken(
  organizationId: string,
  invitationId: string,
  secret: string,
): string {
  return `${organizationId}.${invitationId}.${secret}`;
}

export function parseInvitationToken(raw: unknown): ParsedInvitationToken | null {
  if (typeof raw !== 'string') return null;
  const m = INVITATION_RE.exec(raw.trim());
  if (!m) return null;
  return { organizationId: m[1]!.toLowerCase(), invitationId: m[2]!.toLowerCase(), secret: m[3]! };
}
