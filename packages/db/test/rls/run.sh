#!/usr/bin/env bash
# SQL-level cross-tenant isolation suite. Needs psql, DATABASE_URL_ADMIN and DATABASE_URL.
# Usage: pnpm --filter @tasheel/db test:rls
set -euo pipefail
cd "$(dirname "$0")"

psql "$DATABASE_URL_ADMIN" -q -v ON_ERROR_STOP=1 -f 01-setup.sql
output=$(psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f 02-assert.sql 2>&1) || { echo "$output"; exit 1; }
echo "$output" | grep -oE 'ok [0-9]+ - .*'
echo "RLS isolation suite: all checks passed."
