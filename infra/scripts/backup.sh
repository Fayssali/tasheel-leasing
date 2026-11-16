#!/usr/bin/env bash
# Backs up the database and the uploaded documents of a deployment made with
# infra/production/docker-compose.example.yml. Read-only for the running services.
#
#   infra/scripts/backup.sh /var/backups/tasheel
#
# Produces <dir>/<UTC timestamp>/ with:
#   tasheel.dump        PostgreSQL custom-format dump (pg_restore), whole database
#   documents/          mirror of the private documents bucket
#   SHA256SUMS          checksums, verified by restore.sh
# Copy that folder off the host (another site): a backup on the same disk is not a backup.
set -euo pipefail

DEST_ROOT="${1:?usage: backup.sh <destination directory>}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/production/docker-compose.example.yml}"
ENV_FILE="${ENV_FILE:-infra/production/.env.production}"
KEEP_DAYS="${KEEP_DAYS:-30}"
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST/documents"
umask 077

echo "[backup] database → $DEST/tasheel.dump"
# Custom format: compressed, restorable table by table. Taken as the superuser so that
# Row-Level Security does not hide any row.
compose exec -T postgres pg_dump -U postgres -d tasheel --format=custom \
  > "$DEST/tasheel.dump"

echo "[backup] documents → $DEST/documents"
compose run --rm -T -v "$DEST/documents:/backup" --entrypoint /bin/sh minio-setup -c \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --quiet local/tasheel-documents /backup'

(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "[backup] done: $DEST ($(du -sh "$DEST" | cut -f1))"

if [[ "$KEEP_DAYS" -gt 0 ]]; then
  find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
fi
