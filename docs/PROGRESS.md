# Implementation progress report

## Phase 0 — Specification

- [x] Phase 0 specification delivered (PRD, architecture, journeys, ERD, modules, roadmap, design system, security, monetization).
- [x] Open question resolved: start a clean repository (2026-11-15).
- [x] D1 (multi-tenancy with RLS) accepted, 2026-11-15.
- [ ] Decisions D2–D8 validated by the project owner.

## Phase 1 — Foundation (complete, awaiting demo acceptance)

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

### Done — 2026-11-15, team management and admin console API

- Invitations by email with a role (7 days, latest only); preview; accept with a new account (email verified by the link) or an existing one (email must match); revoke.
- Members: change role, enable/disable. No privilege escalation, last-admin protection, no self-modification.
- Organization profile editing; legal identity locked once verified.
- Admin console API: KPIs, organization search and verification queue, verify / reject / suspend / reactivate (reason required where relevant, concurrent-safe, emailed to the organization's admins), cross-organization audit log.
- Server bootstrap: `db:seed:catalogue` (no demo data) and `db:create-admin`; the full seed refuses demo data in production.
- Design change: invitation acceptance uses a token carrying the organization id (the tenant context is set before lookup) instead of the SECURITY DEFINER function planned earlier. Same protection, less SQL.
- Tests: 85 unit and HTTP tests passing; integration tests for members and admin run in CI.
- Docs: `docs/modules/m0-organizations-and-admin.md`.

### Done — 2026-11-15, Phase 1 web screens

- Auth: login with 2FA step, registration, email verification, forgot/reset password, invitation acceptance.
- Client area: dashboard with onboarding steps, organization profile, team management, security (2FA with QR code and recovery codes).
- Admin area: KPIs, verification queue, organization detail with decisions, audit log.
- Route guards mirror the API: MFA-mandatory users stay on Security until 2FA is on; the platform and client areas follow the active organization.
- 294 interface strings complete in French, Arabic and English; a CI check fails if code uses a missing key.
- Checked visually with headless Chrome against a mocked API, 14 screens in FR / AR, desktop and mobile.

### Phase 1 exit checklist

- [x] Authentication, sessions, lockout, email verification, password reset
- [x] Two-factor authentication, mandatory for platform and bank users
- [x] Multi-tenant isolation in three layers; 12 SQL checks plus Prisma and API integration tests
- [x] Roles, permissions, invitations, member management
- [x] Admin console (verification queue, decisions, audit, KPIs)
- [x] Screens in French and Arabic (RTL), responsive
- [x] Server bootstrap scripts (catalogue-only seed, platform admin)
- [ ] CI green on GitHub (first run of Prisma generate, migrations and integration tests). To be confirmed
- [ ] Demo accepted by the project owner (`docs/demo/phase-1.md`)

## Phase 2 — Marketplace (built, awaiting demo acceptance)

### Done — 2026-11-15

- Database: migrations `0400_marketplace` (categories, listings, images, documents, favourites, quotation requests, quotations, platform settings; full-text search with `unaccent`; reference sequences), `0500_public_profiles` (verified suppliers and institutions readable publicly) and `0600_quotation_requester` (requester snapshot; a business keeps sight of listings it asked about after archiving). RLS suite: 20/20 checks.
- Storage: S3 adapter (MinIO locally), private bucket; files are only served through the API after an RLS check. Upload type is checked from the file's first bytes, not the name.
- Catalogue: 8 categories with their own specification fields (stored in the database). Suppliers draft, edit, publish, archive and restore listings, with up to 10 photos and 5 PDF documents. Publishing needs a verified organization, a photo and a price or "price on request".
- Moderation: database switch "review before publication" (off by default), queue with approve / reject / withdraw (reason required, audited).
- Public marketplace: search (prefix, accent-insensitive, ranked), filters by category, condition, wilaya and price, sorting, equipment page with view counter, supplier profile. No sign-in needed to browse.
- Quotations: verified businesses request a quotation from a listing; suppliers answer with lines, their own VAT rate and a validity date. Totals are computed exactly in centimes. Replace, withdraw, accept, decline, cancel, automatic expiry. Emails in FR / AR / EN.
- Favourites for business users.
- Screens: marketplace, equipment page, supplier profile, supplier catalogue and editor, quotations (both sides), favourites, admin moderation. 509 strings complete in FR / AR / EN. 13 screens checked in headless Chrome, FR / AR, desktop and mobile.
- Demo data (fictional): 3 suppliers, 5 businesses, 20 listings (17 published, plus a draft, one under review and one rejected), quotation requests in every state, favourites. Photos are plain colour placeholders.
- Tests: 107 API unit and HTTP tests; quotation totals tested in `shared`; a marketplace integration test (publish → search → request → quotation → acceptance → archive) runs in CI.
- Docs: `docs/modules/m2-marketplace.md`, demo script `docs/demo/phase-2.md`.

### Not verified in the sandbox

- The seed (including the marketplace demo) and the integration tests run only where the Prisma client can be generated, which means CI or a local machine. The SQL behind them was checked directly on PostgreSQL.

### Deferred from the Phase 2 scope

- Supplier onboarding documents (company registration papers) move to Phase 3 with the document vault shared by financing applications.
- Antivirus scanning of uploads (ClamAV is in Docker Compose under the `scan` profile) is planned with the document vault.

### Phase 2 exit checklist

- [x] Categories, listings, photos, documents, specifications
- [x] Search, filters, equipment and supplier pages
- [x] Quotations end to end, with emails
- [x] Moderation and its database switch
- [x] Isolation checks for every new table (SQL suite 20/20)
- [x] Screens in French and Arabic, responsive
- [x] Fictional demo data
- [ ] CI green on GitHub. To be confirmed
- [ ] Demo accepted by the project owner (`docs/demo/phase-2.md`)

## Phase 3 — Financing applications (next)

Financing request from an accepted quotation, document vault, submission to financial institutions, institution offers. Matching scores and simulations stay labelled indicative; decisions belong to the institutions.
