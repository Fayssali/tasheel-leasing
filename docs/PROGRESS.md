# Implementation progress report

## Phase 0 — Specification

- [x] Phase 0 specification delivered (PRD, architecture, journeys, ERD, modules, roadmap, design system, security, monetization).
- [x] Open question resolved: start a clean repository (2026-11-15).
- [x] D1 (multi-tenancy with RLS) accepted, 2026-11-15.
- [ ] Decisions D2–D8 validated by the project owner.

## CI recovery — 2026-11-15

CI had been failing since the first Phase 1 authentication commit: the sandbox cannot generate the Prisma client, so problems only visible against the real generated types, and the integration tests, had never run. Fixed before recording acceptance:

- Type errors against the generated client (status enums, JSON columns, a `groupBy` inside a transaction, declaration emit in the API app). Status unions now live in `@tasheel/shared` and JSON columns go through `asJson`, so the sandbox typechecks and runs every test again.
- A real bug: audit entries outside any organization (sign-in failures, password resets, MFA setup) were rejected by RLS, because `INSERT … RETURNING` is checked against the SELECT policy. Those requests failed with 500. The audit writer now uses a plain insert.
- One integration assertion was stricter than intended (it rejected the 2FA flag shown on the team page).

First fully green run: build, unit tests, SQL and Prisma isolation suites, seed, all three integration tests (auth, marketplace, financing), formatting — [https://github.com/Fayssali/tasheel-leasing/actions/runs/43765095069](https://github.com/Fayssali/tasheel-leasing/actions/runs/43765095069).

## Phase 1 — Foundation (accepted 2026-11-15)

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
- [x] CI green on GitHub, 2026-11-15 ([run](https://github.com/Fayssali/tasheel-leasing/actions/runs/43765095069))
- [x] Demo accepted by the project owner, 2026-11-15 (`docs/demo/phase-1.md`)

## Phase 2 — Marketplace (accepted 2026-11-15)

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
- [x] CI green on GitHub, 2026-11-15 ([run](https://github.com/Fayssali/tasheel-leasing/actions/runs/43765095069))
- [x] Demo accepted by the project owner, 2026-11-15 (`docs/demo/phase-2.md`)

## Phase 3 — Documents and financing applications (accepted 2026-11-15)

### Done — 2026-11-15

- Database: migration `0700_financing` — document types (reference data), documents (scan and review status, never deleted), financing products, applications from accepted quotations, attachments, one submission per institution, an append-only shared timeline, offers. Two reference sequences (FA, OF). RLS suite: 26/26 checks; Prisma-level isolation cases for the new tables.
- Document vault with antivirus: ClamAV adapter (clamd INSTREAM); infected files refused and never stored; uploads refused when the scanner is down; production refuses to start without `SCAN_MODE=clamav`. Listing PDFs now scanned too. Replacement by superseding. Downloads by other organizations audited.
- Verification papers: checklists per organization type from the database; Tasheel staff accept or ask to replace each paper, with an emailed reason. (Moved here from Phase 2.)
- Institutions configure products: amounts, durations, minimum down payment, categories, wilayas, seniority, indicative rates, extra documents. Nothing hardcoded.
- Business: application from an accepted quotation; indicative matching per product (criteria met, installment range); submission to chosen institutions with required documents enforced; replies to information requests; side-by-side comparison; accept or decline; withdrawal.
- Institution: inbox, review, information requests, decline with reason, offers with the installment and total cost computed exactly from its terms; analysts review, admins issue offers.
- Access rule recorded in ADR 0003: an institution sees an application and its attached documents only once submitted to it, and loses access on withdrawal.
- Emails for every step in FR / AR / EN. 771 interface strings complete. 14 new screens checked in headless Chrome (FR / AR, desktop and mobile).
- Demo data (fictional): 3 banks with 4 products, papers for two businesses (placeholder PDFs), one application with two offers and a decline, one draft.
- Tests: 133 API unit and HTTP tests (including the ClamAV protocol against a fake clamd), 9 shared tests, financing integration test (CI).
- Docs: `docs/modules/m3-financing.md`, ADR 0003, demo script `docs/demo/phase-3.md`.

### Not verified in the sandbox

- The seed, the Prisma-level isolation test and the integration tests need the generated Prisma client, so they run in CI or locally. The SQL behind them (RLS, constraints, sequences) was checked directly on PostgreSQL.
- Real ClamAV was not available here; the adapter was tested against a protocol-faithful fake.

### Phase 3 exit checklist

- [x] Document vault, antivirus, verification papers review
- [x] Institution products and indicative matching
- [x] Application, submission, information requests, offers, decision
- [x] Isolation checks for every new table (SQL 26/26, Prisma cases)
- [x] Screens in French and Arabic, responsive
- [x] Fictional demo data
- [x] CI green on GitHub, 2026-11-15 ([run](https://github.com/Fayssali/tasheel-leasing/actions/runs/43765095069))
- [x] Demo accepted by the project owner, 2026-11-15 (`docs/demo/phase-3.md`)

## Phase 4 — Commissions, invoicing, notifications, reporting, production readiness (demo pending)

Scope confirmed by the project owner's go-ahead on 2026-11-16. The Phase 0 roadmap is not in
the repository, so this scope should still be checked against it.

### Done — 2026-11-16

- Database: migration `0800_billing` — commission rules, commissions (one per accepted deal),
  invoices and credit notes with frozen identity snapshots, lines, gapless yearly counters,
  notifications. `platform_settings` now under RLS (writable by Tasheel staff only).
  RLS suite: 32/32 checks.
- Commissions: rules entirely in the database (payer kind or specific contract, percentage
  with minimum/maximum or fixed fee, categories, validity). Accrued inside the transaction that
  accepts a quotation or a financing proposal; missing ones can be computed after a new rule.
- Invoicing: monthly drafts per payer, issue with continuous numbering, payment recording,
  correction only by credit note. Issuing is refused while billing is not configured or when
  the customer has no RC or NIF. Printable invoice in FR / AR / EN.
- Notification centre mirroring every email, with unread count.
- Reporting: activity overview per organization type and a platform report, with six-month
  charts. Figures computed under the caller's tenant context.
- Production readiness, nothing deployed: production configuration checks (refuses development
  secrets, http URLs, antivirus off), liveness and readiness probes, JSON logs with request ids,
  security headers on API and web; Dockerfiles; example single-host compose (Caddy TLS, Nginx,
  role initialisation from secrets, migration and bucket jobs); backup and restore scripts;
  CI job that builds both images and smoke-tests them in production mode; runbook and
  deployment checklist (`docs/operations/`).
- Fixed on the way: organization status emails had no button label once linked (now checked
  for every template); billing errors translated; month labels hardened.
- Demo data (fictional): billing settings for a fictional issuer, two demo rules, the
  commissions they produce, legal identifiers for the demo organizations.
- Tests: 155 API unit and HTTP tests, 10 shared tests, billing integration test (CI).
- Docs: `docs/modules/m4-billing.md`, demo script `docs/demo/phase-4.md`.

### Not verified in the sandbox

- Seed and integration tests need the generated Prisma client: CI only.
- Backup and restore were not run against the full container stack; the dump-and-restore path
  was rehearsed on the development database (all RLS policies and functions restored, the app
  role still isolated).
- The legal mentions required on Tasheel's own invoices must be confirmed by its accountant.

### Phase 4 exit checklist

- [x] Commission rules, accrual, invoices, payments, credit notes
- [x] Notification centre and reporting for each side
- [x] Isolation checks for every new table (SQL 32/32)
- [x] Screens in French and Arabic, responsive
- [x] Production readiness files, without any deployment
- [x] Fictional demo data
- [x] CI green on GitHub, 2026-11-16, including the container image build and production-mode smoke test ([run](https://github.com/Fayssali/tasheel-leasing/actions/runs/43861670990))
- [ ] Demo accepted by the project owner (`docs/demo/phase-4.md`)

## Next

- Deployment: needs the project owner's explicit authorization, a hosting choice and the
  decisions listed in `docs/operations/deployment-checklist.md`.
- Decisions D2–D8 from Phase 0 still to be validated.
