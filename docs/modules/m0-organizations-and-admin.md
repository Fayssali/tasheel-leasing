# M0 — Organizations, members and admin console

Part of the Foundation module (Phase 1). Depends on: M0 auth and access (guards, tenant context), AuditService, Mailer.

## Organization profile and team (any organization)

All routes need `Authorization: Bearer …` and `X-Organization-Id`.

| Method | Path                                     | Permission            | Purpose                                                                                                        |
| ------ | ---------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/current`                 | `organization.read`   | Profile, status and the caller's permissions                                                                   |
| PATCH  | `/organizations/current`                 | `organization.update` | Edit profile. Legal identity (legal name, RC, NIF, NIS, article) is locked once `VERIFIED` (`IDENTITY_LOCKED`) |
| GET    | `/organizations/current/members`         | `member.read`         | Members, roles, MFA status                                                                                     |
| PATCH  | `/organizations/current/members/:id`     | `member.manage`       | `{ roleCode?, status? }`: change role (one role per member) or enable/disable                                  |
| GET    | `/organizations/current/roles`           | `member.read`         | Assignable roles, each with `assignableByYou`                                                                  |
| GET    | `/organizations/current/invitations`     | `member.read`         | Pending invitations                                                                                            |
| POST   | `/organizations/current/invitations`     | `member.invite`       | `{ email, roleCode }`: sends an invitation valid 7 days                                                        |
| DELETE | `/organizations/current/invitations/:id` | `member.invite`       | Revoke                                                                                                         |

Invitee side:

| Method | Path                           | Auth   | Purpose                                                                                                                                    |
| ------ | ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/invitations/preview?token=…` | Public | Organization, role, email, whether an account exists                                                                                       |
| POST   | `/invitations/accept`          | Public | New account: `{ token, firstName, lastName, password, acceptTerms }`. The email counts as verified (proved by the link). Signs the user in |
| POST   | `/invitations/accept-existing` | Bearer | Existing account: the invitation must be addressed to the caller's email (`INVITATION_EMAIL_MISMATCH`)                                     |

Rules:

- **No privilege escalation**: nobody can assign a role, or modify a member, whose permissions exceed their own (`ROLE_EXCEEDS_YOUR_PERMISSIONS`).
- **Never orphaned**: the last active member holding `member.manage` cannot be disabled or downgraded (`LAST_ADMIN`). Nobody can change their own role or status (`CANNOT_MODIFY_SELF`).
- A disabled member loses access to the organization immediately, on their next request.
- Invitation token: `<organizationId>.<invitationId>.<secret>`, stored as SHA-256. Only the latest invitation per email is valid. Acceptance is a conditional update, so two simultaneous accepts cannot both succeed. Invitations of suspended or rejected organizations are refused.
- An invitation for an email that already has an account cannot be used to create a second account (`ACCOUNT_EXISTS`).

## Admin console (Tasheel staff only)

Every route requires a platform-only permission, so it works only with `X-Organization-Id` set to the platform organization. Platform members must have MFA enabled (otherwise `MFA_SETUP_REQUIRED`).

| Method | Path                                                               | Permission                  | Purpose                                                                                               |
| ------ | ------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/admin/kpis`                                                      | `admin.kpi.read`            | Organizations by type and status, pending verifications, users, new organizations in the last 30 days |
| GET    | `/admin/organizations?status&type&q&cursor&limit`                  | `admin.organization.read`   | Search by name, NIF or RC. The verification queue (`status=PENDING_VERIFICATION`) is oldest first     |
| GET    | `/admin/organizations/:id`                                         | `admin.organization.read`   | Detail with members (email verified, MFA, last login)                                                 |
| POST   | `/admin/organizations/:id/verify`                                  | `admin.organization.verify` | PENDING or REJECTED → VERIFIED                                                                        |
| POST   | `/admin/organizations/:id/reject`                                  | `admin.organization.verify` | PENDING → REJECTED, `{ reason }` required                                                             |
| POST   | `/admin/organizations/:id/suspend`                                 | `admin.organization.verify` | PENDING or VERIFIED → SUSPENDED, `{ reason }` required                                                |
| POST   | `/admin/organizations/:id/reactivate`                              | `admin.organization.verify` | SUSPENDED → VERIFIED if verified before, otherwise back to PENDING                                    |
| GET    | `/admin/audit-logs?organizationId&action&actorUserId&cursor&limit` | `admin.audit.read`          | Audit trail across organizations. `action` filters by prefix (`organization.`)                        |

- Decisions are audited against the target organization and emailed to its administrators in their language.
- Status changes are conditional on the status that was read, so two agents deciding at the same time get `CONCURRENT_CHANGE` rather than silently overwriting each other. The platform organization itself can never be changed here.

## Bootstrapping a server

```bash
pnpm db:deploy                       # migrations
pnpm db:seed:catalogue               # permissions and system roles only — never demo data in production
PLATFORM_ADMIN_PASSWORD='…' pnpm db:create-admin -- --email admin@tasheel.dz --first Prénom --last Nom
```

The script creates the platform organization if needed and is safe to run again. The password comes from the environment, never the command line. The admin must enable MFA at first sign-in. The full seed (`pnpm db:seed`) refuses to create demo organizations when `NODE_ENV=production`.
