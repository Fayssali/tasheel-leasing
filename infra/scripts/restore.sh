#!/usr/bin/env bash
# Restores a backup made by backup.sh. DESTRUCTIVE for the target: the database is
# replaced and the documents bucket is overwritten. Meant first for restore DRILLS on a
# separate machine; on a live deployment, only with the project owner's go-ahead.
#
#   RESTORE_CONFIRM=tasheel infra/scripts/restore.sh /var/backups/tasheel/20261116T020000Z
#
# The API and web containers are stopped during the restore and started again at the end.
set -euo pipefail

SRC="${1:?usage: restore.sh <backup folder>}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/production/docker-compose.example.yml}"
ENV_FILE="${ENV_FILE:-infra/production/.env.production}"
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

if [[ "${RESTORE_CONFIRM:-}" != "tasheel" ]]; then
  echo "Refusing: this replaces the database and documents. Re-run with RESTORE_CONFIRM=tasheel." >&2
  exit 1
fi

echo "[restore] verifying checksums"
(cd "$SRC" && sha256sum --quiet -c SHA256SUMS)

echo "[restore] stopping api and web"
compose stop web api

echo "[restore] database"
compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -d postgres <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'tasheel' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS tasheel;
CREATE DATABASE tasheel OWNER tasheel_admin;
SQL
compose exec -T postgres pg_restore -U postgres -d tasheel --exit-on-error < "$SRC/tasheel.dump"

echo "[restore] documents"
compose run --rm -T -v "$SRC/documents:/backup:ro" --entrypoint /bin/sh minio-setup -c \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mb --ignore-existing local/tasheel-documents && mc mirror --quiet --overwrite /backup local/tasheel-documents'

echo "[restore] starting api and web"
compose up -d api web
echo "[restore] done. Check: curl -fsS https://\$TASHEEL_DOMAIN/api/v1/health"
