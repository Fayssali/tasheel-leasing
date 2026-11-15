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

### Next

1. Email verification and password reset (Mailpit locally).
2. MFA (TOTP) for platform and institution users.
3. Members and invitations (with the SECURITY DEFINER accept function).
4. Admin console API: verification queue, verify/reject/suspend, audit log viewer.
5. Web: login, registration and organization switcher screens; admin console screens.
6. Phase 1 demo.
