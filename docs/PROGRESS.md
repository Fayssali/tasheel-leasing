# Implementation progress report

## Phase 0 — Specification

- [x] Phase 0 specification delivered (PRD, architecture, journeys, ERD, modules, roadmap, design system, security, monetization).
- [x] Open question resolved: start a clean repository (2026-11-15).
- [x] D1 (multi-tenancy with RLS) accepted, 2026-11-15.
- [ ] Decisions D2–D8 validated by the project owner.

## Phase 1 — Foundation (in progress)

### Done — 2026-11-15, repository bootstrap

- Monorepo: pnpm workspaces + Turborepo; apps `api`, `web`; packages `db`, `shared`, `i18n`.
- Local infrastructure: Docker Compose (Postgres 16, Redis 7, MinIO, Mailpit, optional ClamAV); Postgres init script creating `tasheel_admin` and `tasheel_app` (NOBYPASSRLS).
- Database: Prisma schema for M0 (organizations, users, members, roles, permissions, invitations, sessions, audit log). Migrations `init_foundation` and `rls_foundation` (RLS policies, context functions, append-only audit log).
- Tenant context helper `withTenantContext` and `PrismaService.forTenant`.
- Isolation suite: 10 SQL checks (`test:rls`), all passing. A Prisma-level twin (`tenant-isolation.test.ts`) is ready to run.
- Shared: permission catalogue, 8 system roles (FR / AR / EN names), money utilities with tests.
- i18n: FR / AR / EN files with a key-completeness check.
- API: NestJS skeleton (config validation, Helmet, CORS, global validation pipe, rate limiting, `/api/v1/health`) with tests.
- Web: React + Vite + Tailwind 4 shell with design tokens, IBM Plex fonts (self-hosted), FR / AR switch with RTL, API status indicator.
- CI workflow: install, build, tests, i18n check, migrations, RLS suite.

### Verification notes

- Verified in the build sandbox: migrations applied on PostgreSQL 16; RLS suite 10/10; shared tests; i18n check; API build and tests; web typecheck and build.
- **Not verified in the sandbox:** Prisma engine binaries could not be downloaded there (network policy), so `prisma generate`, `prisma migrate` and the seed did not run. The two migrations were written by hand to match `schema.prisma`. On the first local `pnpm db:migrate`, Prisma confirms that schema and migrations agree. If it proposes a new migration, review the difference before accepting it.

### Done — 2026-11-15, authentication and access control

- Register (organization + first admin, `PENDING_VERIFICATION`), login, refresh rotation with reuse detection, logout, `me`.
- Argon2id passwords, progressive lockout, no account enumeration (same error and same timing).
- Global guard chain: rate limit → JWT → tenant (`X-Organization-Id`, active membership, blocked organizations) → permissions.
- `GET /organizations/current` and `/organizations/current/members` as the first permission-protected routes.
- AuditService writing in the same transaction as the change. Auth events are audited.
- Tests: 27 unit and HTTP tests passing in the sandbox. An integration test of the full flow on PostgreSQL with RLS (`test:int`) runs in CI.
- Documentation: `docs/modules/m0-auth-and-access.md`.
- Decision D1 recorded as accepted (ADR 0002).

### Done — 2026-11-15, email verification and password reset

- `user_tokens` table (migration `20261115000200_user_tokens`) with RLS: owner-only, no deletes by the app role. Two new SQL isolation checks (12/12 passing) and a Prisma-level case.
- Mailer abstraction with an SMTP implementation (Mailpit locally). Email templates in FR / AR / EN from the i18n files, right-to-left for Arabic, HTML-escaped.
- Endpoints: re-send verification, verify, forgot password (always 202, background lookup), reset (single-use, clears lockout, revokes all sessions, notifies).
- Sign-up sends the verification email automatically.
- Tests: 40 unit and HTTP tests passing; the integration test now also covers verify → forgot → reset on PostgreSQL (runs in CI).

### Done — 2026-11-15, two-factor authentication

- TOTP (RFC 6238) written in-house and checked against the RFC test vectors; base32; otpauth URI for authenticator apps.
- Secrets encrypted with AES-256-GCM (`MFA_ENCRYPTION_KEY`); production rejects the development key.
- Migration `20261115000300_user_mfa`: pending secret, hashed recovery codes, last used step.
- Setup → enable (10 recovery codes, other sessions signed out) → disable → regenerate codes.
- Two-step login with a 5-minute challenge token that cannot act as an access token. Replay protection and atomic recovery-code use. Wrong codes count toward lockout.
- Mandatory for platform and institution members: organization routes return `MFA_SETUP_REQUIRED` until enabled, and disabling is refused.
- Tests: 66 unit and HTTP tests passing; the integration test now covers the bank-user MFA journey on PostgreSQL (runs in CI).

### Next

1. Members and invitations (with the SECURITY DEFINER accept function).
2. Admin console API: verification queue, verify/reject/suspend, audit log viewer.
3. Web: login, registration, email verification, password reset, MFA setup and organization switcher screens; admin console screens.
4. Phase 1 demo.
