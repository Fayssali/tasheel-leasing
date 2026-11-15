-- Two roles, by design (see docs/adr/0002-multi-tenancy.md):
--   tasheel_admin : owns the schema, runs migrations and seeds. Not used by the API.
--   tasheel_app   : used by the API at runtime. NO superuser, NO BYPASSRLS,
--                   so Row-Level Security policies always apply to it.
-- Development passwords only. Production credentials come from the secret store.

CREATE ROLE tasheel_admin WITH LOGIN PASSWORD 'tasheel_admin_dev' CREATEDB;
CREATE ROLE tasheel_app WITH LOGIN PASSWORD 'tasheel_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE tasheel OWNER tasheel_admin;

\connect tasheel

-- The app role can use the schema but never alter it.
GRANT USAGE ON SCHEMA public TO tasheel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tasheel_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tasheel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tasheel_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tasheel_app;
