#!/usr/bin/env bash
# First-start initialisation of the production database (runs once, on an empty volume).
# Same two-role design as development (docs/adr/0002-multi-tenancy.md), with passwords
# taken from the environment instead of the development values.
set -euo pipefail
: "${TASHEEL_ADMIN_PASSWORD:?set TASHEEL_ADMIN_PASSWORD}"
: "${TASHEEL_APP_PASSWORD:?set TASHEEL_APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v admin_pw="$TASHEEL_ADMIN_PASSWORD" -v app_pw="$TASHEEL_APP_PASSWORD" <<'SQL'
CREATE ROLE tasheel_admin WITH LOGIN PASSWORD :'admin_pw' NOCREATEDB NOCREATEROLE;
CREATE ROLE tasheel_app WITH LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE tasheel OWNER tasheel_admin;
\connect tasheel
CREATE EXTENSION IF NOT EXISTS unaccent;
GRANT USAGE ON SCHEMA public TO tasheel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tasheel_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tasheel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tasheel_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tasheel_app;
SQL
