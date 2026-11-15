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

## Two-factor authentication (TOTP)

- RFC 6238, HMAC-SHA1, 6 digits, 30-second steps, ±1 step of clock drift. This works with every common authenticator app. The implementation is in-house and checked against the RFC test vectors.
- **Mandatory** for members of `PLATFORM` and `FINANCIAL_INSTITUTION` organizations (`MFA_REQUIRED_ORG_TYPES` in `@tasheel/shared`). Until it is enabled, they can sign in and set it up, but every organization route answers `403 MFA_SETUP_REQUIRED`. `GET /auth/me` returns `mfaSetupRequired: true` so the web app can send them to the setup screen.
- Two-step login: a correct password returns a 5-minute challenge token (JWT audience `tasheel-mfa`), which the API never accepts as an access token. No session or cookie exists until the second step succeeds.
- Secrets are encrypted at rest with AES-256-GCM (`MFA_ENCRYPTION_KEY`, 32 bytes, base64). Production refuses the development key.
- Replay protection: the last accepted time step is stored, and a code at or before it is refused. The check is a conditional UPDATE, so two simultaneous requests cannot both use the same code.
- Recovery codes: 10 codes in `xxxx-xxxx` form, avoiding look-alike characters, stored as SHA-256 hashes. Each one is removed atomically when used.
- Wrong second-step codes count toward the same progressive lockout as wrong passwords.
- Setup and disable require the current password. Enabling MFA signs out every other session.

## Email verification and password reset

- Links point to the web app (`WEB_APP_URL`): `/verify-email?token=…` and `/reset-password?token=…`. The token is `<userId>.<secret>`; only SHA-256(secret) is stored, in `user_tokens` (visible to its owner only, through RLS).
- Verification links last 48 hours and reset links 30 minutes. All links are single-use, and requesting a new link invalidates earlier ones of the same kind.
- Sign-up sends the verification email automatically. Login is allowed before verification; later phases will require a verified email for sensitive actions (submitting an application, issuing a proposal).
- A completed reset clears any lockout, verifies the email (the link proves mailbox ownership), revokes every session and sends a "password changed" notification.
- Emails are sent after the transaction commits and are never awaited by the response. Phase 6 moves sending to a queue with retries. Locally, emails arrive in Mailpit at http://localhost:8025.
- Email text lives in `packages/i18n/locales/*.json` (`email.*`) and is sent in the user's language. Arabic is right-to-left.

## Audit events

`auth.registered`, `auth.email_verification_sent`, `auth.email_verified`, `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.mfa_setup_started`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_recovery_codes_regenerated`, `auth.mfa_challenge_issued`, `auth.mfa_failed`, `auth.login_succeeded` (with `method`: password, totp or recovery), `auth.login_failed`, `auth.account_locked`, `auth.login_blocked_locked`, `auth.refresh_reuse_detected`, `auth.logged_out`.

## Error codes

`UNAUTHENTICATED`, `TOKEN_INVALID`, `INVALID_TOKEN` (email link), `INVALID_CREDENTIALS`, `INVALID_SESSION`, `EMAIL_TAKEN`, `INVALID_MFA_CODE`, `MFA_CHALLENGE_EXPIRED`, `MFA_SETUP_REQUIRED`, `MFA_REQUIRED_BY_POLICY`, `MFA_ALREADY_ENABLED`, `MFA_NOT_ENABLED`, `MFA_SETUP_NOT_STARTED`, `PASSWORD_INCORRECT`, `ORGANIZATION_REQUIRED`, `NOT_A_MEMBER`, `ORGANIZATION_BLOCKED`, `PERMISSION_DENIED`.

## Not yet built

Invitations, and the session list with "sign out other devices".
