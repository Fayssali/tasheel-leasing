# M0 — Authentication and access control

Part of the Foundation module (Phase 1). Depends on: `@tasheel/db` (tenant context, RLS), `@tasheel/shared` (permission catalogue, system roles), AuditService.

## Endpoints

All under `/api/v1`. Every route requires a Bearer access token unless marked public.

| Method | Path                             | Auth                                               | Purpose                                                                                                                                                        |
| ------ | -------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`                 | Public, 5/min                                      | Create an organization (supplier, institution or business) in `PENDING_VERIFICATION` plus its first admin. Returns an access token and sets the refresh cookie |
| POST   | `/auth/login`                    | Public, 10/min                                     | Email and password. Returns an access token and sets the refresh cookie                                                                                        |
| POST   | `/auth/refresh`                  | Refresh cookie, 10/min                             | Rotates the refresh token and returns a new access token                                                                                                       |
| POST   | `/auth/logout`                   | Bearer                                             | Revokes the current session and clears the cookie                                                                                                              |
| GET    | `/auth/me`                       | Bearer                                             | Profile plus memberships (for the organization switcher)                                                                                                       |
| GET    | `/organizations/current`         | Bearer + `X-Organization-Id` + `organization.read` | Active organization profile and the caller's permissions                                                                                                       |
| GET    | `/organizations/current/members` | Bearer + `X-Organization-Id` + `member.read`       | Members and their roles                                                                                                                                        |
| GET    | `/health`                        | Public                                             | Liveness and database readiness                                                                                                                                |

## Tokens and sessions

- **Access token**: JWT HS256, 15 minutes, claims `sub` (user) and `sid` (session), issuer `tasheel`, audience `tasheel-api`. Sent as `Authorization: Bearer …`. Kept in memory by the web app, never in localStorage.
- **Refresh token**: `<userId>.<sessionId>.<secret>` in an `httpOnly`, `SameSite=Strict` cookie restricted to `/api/v1/auth` (`Secure` in production), valid 7 days from login. Only the SHA-256 of the secret is stored.
- **Rotation and reuse detection**: each refresh replaces the secret. Presenting an old secret revokes the whole session and writes `auth.refresh_reuse_detected` to the audit log.
- **Revocation**: logout and reuse detection take effect at the next refresh. Access tokens are not checked against the session table on every request, so a revoked session can still use its access token for up to 15 minutes.

## Credentials

- Argon2id (19 MiB memory, 2 iterations). Passwords are 12 to 128 characters.
- Lockout: 15 minutes after 5 consecutive failures, doubling every further 5 failures, capped at 24 hours. Reset on success.
- No account enumeration: unknown email, wrong password and locked account all return `401 INVALID_CREDENTIALS`. Unknown emails still run a dummy hash check, so response times match.

## Access control chain (global guards, in order)

1. **ThrottlerGuard**: 120 requests/min by default, stricter on auth routes.
2. **JwtAuthGuard**: validates the access token unless the route is `@Public()`.
3. **TenantGuard**: on routes with `@RequirePermissions` or `@TenantScoped`, reads `X-Organization-Id`, checks the user is an ACTIVE member, blocks SUSPENDED or REJECTED organizations and loads permissions.
4. **PermissionsGuard**: deny unless the member holds every permission listed.

Database queries then run through `PrismaService.forTenant(tenant, …)`, which sets the RLS context, so the database enforces isolation again.

## Audit events

`auth.registered`, `auth.login_succeeded`, `auth.login_failed`, `auth.account_locked`, `auth.login_blocked_locked`, `auth.refresh_reuse_detected`, `auth.logged_out`.

## Error codes

`UNAUTHENTICATED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`, `INVALID_SESSION`, `EMAIL_TAKEN`, `ORGANIZATION_REQUIRED`, `NOT_A_MEMBER`, `ORGANIZATION_BLOCKED`, `PERMISSION_DENIED`.

## Not yet built

Email verification, password reset, MFA (TOTP, mandatory for platform and institution users), invitations, and the session list with "sign out other devices".
