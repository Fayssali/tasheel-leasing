# Project rules — Tasheel Leasing

These rules come from the master brief and the Phase 0 specification. They apply to every change.

## Positioning

- Tasheel is a technology intermediary. Never present it as a bank, leasing company or lender.
- Never auto-approve applications or produce a credit decision. Matching scores and calculator outputs are always labelled **indicative**.
- UI wording: "proposal", "decision of the institution", "indicative". Never "approved by Tasheel" or "guaranteed".

## Data and security

- Every tenant-owned table has `organization_id NOT NULL` and an RLS policy in a hand-written migration.
- Every new tenant table gets a case in `packages/db/test/rls/02-assert.sql` and `packages/db/test/tenant-isolation.test.ts`.
- The API connects as `tasheel_app` (subject to RLS). Tenant queries go through `PrismaService.forTenant(...)`.
- Financial and contractual records are never hard-deleted. `audit_logs` is append-only.
- Never log or return `password_hash`, `mfa_secret` or document contents.

## Configuration, not code

- No hardcoded commission rates, prices, interest or profit rates, VAT, fees or eligibility rules. They live in the database and are edited by the admin.
- Money: decimal strings in the API, `NUMERIC(18,2)` in the database, BigInt centimes in code (`@tasheel/shared/money`). Never floats.
- Every user-facing string is in `packages/i18n/locales/*.json`. French is the reference locale. Use Tailwind logical utilities (`ms-*`, `ps-*`, `text-start`) so Arabic RTL works.

## Integrations and operations

- No real bank, payment or e-signature integration without signed agreements and credentials. Use adapters with simulated implementations.
- Demo data is fictional and marked as such.
- Never deploy to production, run migrations on production, delete resources or change production infrastructure without explicit authorization from the project owner.

## Process

- Work phase by phase (Phase 0 specification, section 7). Each phase ends with a demo and an update to `docs/PROGRESS.md`.
- Record significant decisions as ADRs in `docs/adr/`.
