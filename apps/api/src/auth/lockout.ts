/**
 * Progressive account lockout (Phase 0 specification, section 9.2):
 * after every 5 consecutive failures the account locks, for 15 min the first time,
 * then doubling (30, 60, …) up to 24 h. A successful login resets the counter.
 * These are security parameters, not business rules, so they live in code.
 */
export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

export function lockUntilAfterFailure(failedCount: number, now: Date): Date | null {
  if (failedCount < LOCKOUT_THRESHOLD || failedCount % LOCKOUT_THRESHOLD !== 0) return null;
  const level = failedCount / LOCKOUT_THRESHOLD - 1;
  const minutes = Math.min(BASE_LOCK_MINUTES * 2 ** level, MAX_LOCK_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

export function isLocked(lockedUntil: Date | null | undefined, now: Date): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}
