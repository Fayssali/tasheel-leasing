# ADR 0002 — Multi-tenancy with shared schema and Row-Level Security

- Status: Accepted, 2026-11-15 (decision D1: the owner approved moving on to authentication on this basis)
- Date: 2026-11-15

## Context

Suppliers, financial institutions and businesses share one platform. Company financial documents and applications must never leak between organizations. Some data is shared on purpose: an application is shared with the institutions the business selected.

## Decision

- **Tenant = Organization.** Shared database, shared schema, `organization_id` on every tenant-owned table.
- **Three layers of enforcement:**
  1. API permission guard (deny by default).
  2. `withTenantContext` sets `app.org_id` and `app.user_id` per transaction (`set_config(..., true)`, so the setting is transaction-scoped and safe with pooled connections).
  3. PostgreSQL Row-Level Security policies on every tenant table.
- **Two database roles:** `tasheel_admin` owns the schema and runs migrations and seeds. `tasheel_app` is used by the API and has `NOBYPASSRLS`.
- The platform organization (type `PLATFORM`) can read across tenants through `app_is_platform()`. Support access to private business documents will additionally require a logged, time-boxed support session (Phase 1, admin console).
- Sharing between tenants (application to institution, document grants) uses explicit grant rows, added with the Phase 3 tables.

## Consequences

- A bug in one layer does not expose data on its own.
- Every new tenant table needs an RLS migration and an isolation test case (see CLAUDE.md).
- RLS policies are hand-written SQL migrations, because Prisma does not generate them.
- `users` is global (one person can belong to several organizations), so it is protected at the API level for now.
