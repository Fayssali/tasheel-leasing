# Tasheel Leasing

B2B digital leasing marketplace and financing intermediation platform for the Algerian market. It connects equipment suppliers, businesses, leasing companies and banks.

Tasheel is a **technology intermediary only**. It does not lend, hold funds or make credit decisions. Financing decisions rest solely with the financial institutions.

> Status: **Phase 1, Foundation, complete** (awaiting demo acceptance). Development environment, fictional data only. Demo script: [docs/demo/phase-1.md](docs/demo/phase-1.md).
> Specification: [Phase 0 Specification](https://claude.ai/artifact/7qyaTrP2Bk89HyTtAUosnd) (PRD, architecture, ERD, roadmap).

## Stack

| Layer         | Technology                                                                             |
| ------------- | -------------------------------------------------------------------------------------- |
| Web           | React 19, TypeScript, Vite, Tailwind CSS 4, i18next (FR / AR with RTL), TanStack Query |
| API           | NestJS 11, REST under `/api/v1`                                                        |
| Database      | PostgreSQL 16 with Row-Level Security, Prisma 6                                        |
| Infra (local) | Docker Compose: Postgres, Redis, MinIO, Mailpit, ClamAV (optional)                     |
| Monorepo      | pnpm workspaces, Turborepo                                                             |

## Repository layout

```
apps/
  api/        NestJS API (modular monolith, one module per domain)
  web/        React single-page app (all portals, role-based routing)
packages/
  db/         Prisma schema, migrations (incl. RLS SQL), seed, isolation tests
  shared/     Enums, permission catalogue, system roles, money utilities
  i18n/       fr.json, ar.json, en.json (+ key-completeness check)
infra/docker/ docker-compose.yml, Postgres role init script
docs/         ADRs and progress report
```

## Getting started

Prerequisites: Node 22, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up              # Postgres, Redis, MinIO, Mailpit
pnpm db:migrate            # applies migrations as tasheel_admin
pnpm db:seed               # permissions, system roles, 4 fictional demo organizations
pnpm --filter @tasheel/db test:rls   # cross-tenant isolation suite (SQL)
pnpm dev                   # API on :3000, web on :5173
```

The first `pnpm db:migrate` also confirms that the schema and migrations agree. If Prisma
proposes a new migration, report it before accepting it (see `docs/PROGRESS.md`).

Local services: web http://localhost:5173 · API health http://localhost:3000/api/v1/health · Mailpit http://localhost:8025 · MinIO console http://localhost:9001.

Demo logins (fictional): `admin@`, `fournisseur@`, `banque@`, `entreprise@demo.tasheel.local`. The password comes from `SEED_DEMO_PASSWORD` (default in `packages/db/prisma/seed.ts`). The admin and bank users must set up 2FA at first sign-in.

Module documentation: [auth and access](docs/modules/m0-auth-and-access.md) · [organizations and admin](docs/modules/m0-organizations-and-admin.md).

## Commands

| Command                              | What it does                                             |
| ------------------------------------ | -------------------------------------------------------- |
| `pnpm build`                         | Build every package and app                              |
| `pnpm test`                          | Unit and API tests across the workspace                  |
| `pnpm --filter @tasheel/db test`     | Prisma-level isolation tests (needs a migrated database) |
| `pnpm --filter @tasheel/db test:rls` | SQL-level isolation tests (needs `psql`)                 |
| `pnpm db:studio`                     | Prisma Studio                                            |
| `pnpm format`                        | Prettier                                                 |

## Ground rules

See [CLAUDE.md](CLAUDE.md). In short: no hardcoded financial parameters, no cross-tenant data exposure, every important action audited, no fake bank integrations, and no production change without explicit authorization.
