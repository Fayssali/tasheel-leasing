# Runbook

Day-to-day operation of a deployment made from `infra/production/docker-compose.example.yml`.
All commands run from the repository root on the server, with:

```sh
alias tc='docker compose -f infra/production/docker-compose.example.yml --env-file infra/production/.env.production'
```

## Health

| Probe                     | Meaning                        | Used by                                     |
| ------------------------- | ------------------------------ | ------------------------------------------- |
| `GET /api/v1/health/live` | the API process answers        | container health check (restart if failing) |
| `GET /api/v1/health`      | the API can reach the database | load balancer, monitoring, web footer       |
| `GET /healthz` (web)      | Nginx answers                  | container health check                      |

`tc ps` shows the health of every container.

## Logs

- The API writes one JSON object per line: start-up, errors, and one line per request with
  `requestId`, `method`, `path`, `status` and `ms`. Bodies, query strings, cookies and headers
  are never logged.
- Every response carries `X-Request-Id`. When a user reports an error, ask for the time and,
  if possible, that id: `tc logs api | grep <id>`.
- Business actions (who verified an organization, issued an invoice, accepted an offer…) are
  not in the logs but in the audit journal, visible to Tasheel administrators in the app.

## Releasing a new version

1. CI green on the commit, including `container-images`.
2. Take a backup (below).
3. Set `TASHEEL_VERSION` to the new tag, then `tc pull && tc up -d`. `migrate` runs first;
   if a migration fails, the API is not restarted and keeps the previous version running.
4. Check `/api/v1/health` and sign in.

Migrations only move forward. To undo a release, restore the backup taken in step 2 and
start the previous tag: never edit a migration that has already run.

## Backups

```sh
infra/scripts/backup.sh /var/backups/tasheel
```

Dumps the whole database (as the superuser, so Row-Level Security hides nothing) and mirrors
the documents bucket into a dated folder with checksums; folders older than `KEEP_DAYS`
(default 30) are removed. Schedule it daily, e.g. `/etc/cron.d/tasheel-backup`:

```
15 2 * * * root cd /opt/tasheel && infra/scripts/backup.sh /var/backups/tasheel >> /var/log/tasheel-backup.log 2>&1
```

Then copy `/var/backups/tasheel` to another site (rclone, restic…). The encryption key for
two-step verification (`MFA_ENCRYPTION_KEY`) is not in the backup: keep it in the secret store.

## Restoring

Practise on a separate machine every quarter, and after any schema change:

```sh
RESTORE_CONFIRM=tasheel infra/scripts/restore.sh /var/backups/tasheel/<folder>
```

The script checks the checksums, stops the API and web, replaces the database and the
documents, then starts them again. On the live deployment, only with the project owner's
go-ahead: everything written since the backup is lost.

The dump-and-restore path was rehearsed on the development database: all Row-Level Security
policies and security-definer functions come back, and the application role still sees no
tenant rows without a tenant context.

## Common incidents

| Symptom                                                                   | Likely cause                                     | What to do                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| API restarts in a loop, log says `Unsafe production configuration`        | a secret is missing or still a development value | fix `.env.production`, `tc up -d api`                             |
| `/api/v1/health` returns 503                                              | PostgreSQL down or out of connections            | `tc logs postgres`; check disk space                              |
| Uploads fail with a scan error                                            | ClamAV not ready or out of memory                | `tc logs clamav`; signatures reload after updates                 |
| Emails not received                                                       | SMTP credentials or DNS (SPF/DKIM)               | `tc logs api                                                      | grep -i mail` |
| Users locked out of two-step verification after a restore on a new server | different `MFA_ENCRYPTION_KEY`                   | use the key from the secret store                                 |
| Rate-limit errors (429) for a whole company                               | many users behind one address                    | expected with in-memory limits; review limits before raising them |
