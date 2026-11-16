# Deployment checklist

Nothing in this repository deploys anything. This checklist is for the first production
deployment, which needs the project owner's explicit go-ahead and a chosen hosting target
(CLAUDE.md, "Integrations and operations"). Tick every line before opening the service to
users.

The reference layout is `infra/production/docker-compose.example.yml`: one host, Caddy for
TLS, Nginx serving the app and forwarding `/api`, the API, PostgreSQL 16, MinIO and ClamAV.
A managed PostgreSQL or object store can replace the bundled ones; the checks stay the same.

## 1. Decisions to take first

- [ ] Hosting provider and region. Financial and identity documents of Algerian companies
      are stored: confirm the data-residency and personal-data rules that apply
      (law 18-07 on personal data, ANPDP) with counsel before choosing a location.
- [ ] Domain name, and who controls its DNS.
- [ ] Outgoing email provider (SMTP), with SPF, DKIM and DMARC records for the sending domain.
- [ ] Where backups are copied (another site or provider than the server), and who can read them.
- [ ] Who holds the secrets, and where they live (a secret store, not a shared document).
- [ ] Decisions D2–D8 from the Phase 0 specification are validated (still open in `docs/PROGRESS.md`).

## 2. Host

- [ ] Supported Linux with automatic security updates; Docker Engine and the compose plugin.
- [ ] Firewall: only 80 and 443 open to the Internet; SSH restricted (keys only, no root login).
- [ ] At least 4 GB RAM (ClamAV alone needs about 1.5 GB) and disk monitoring.
- [ ] Clock synchronised (NTP): two-step verification codes depend on it.

## 3. Secrets (`infra/production/.env.production`, never committed)

- [ ] Every value filled in; passwords generated with `openssl rand -hex 32`.
- [ ] `MFA_ENCRYPTION_KEY` generated with `openssl rand -base64 32` and **stored in the secret
      store**. Losing it makes every user's two-step verification unusable.
- [ ] `TASHEEL_VERSION` set to the image tag being deployed (the git commit SHA).
- [ ] The API refuses to start on an unsafe value (development passwords, placeholder secrets,
      non-https URLs, antivirus off): if it does not start, read its log first.

## 4. First start

- [ ] Images built from a commit whose CI is green (the `container-images` job builds and
      smoke-tests exactly these images).
- [ ] `docker compose … up -d`. On the first start PostgreSQL creates the two roles
      (`tasheel_admin` owns the schema, `tasheel_app` is subject to Row-Level Security),
      `migrate` applies the migrations, `minio-setup` creates the private bucket, then the API
      and web start.
- [ ] ClamAV downloads its signatures on first start (several minutes); the API waits for it.
- [ ] `curl -fsS https://<domain>/api/v1/health` returns `"database":"up"`.
- [ ] Load the reference data with `pnpm db:seed:catalogue`: permissions, system roles,
      equipment categories and document types, and no demo data. Required before anyone can
      sign in. (The full seed refuses to run with `NODE_ENV=production`: it creates fictional
      demo organizations.)
- [ ] Create the first Tasheel administrator with `pnpm db:create-admin`, then sign in and
      enable two-step verification. Both commands run from an operator machine against the
      production database through an SSH tunnel, with `DATABASE_URL_ADMIN` pointing at it.
- [ ] Billing settings (issuer identity, VAT rate, payment terms, numbering prefixes) and
      commission rules entered by the administrator: there are no defaults, and no invoice
      can be issued before they exist.
- [ ] Equipment categories and document types reviewed by the administrator.

## 5. Verification before opening

- [ ] TLS certificate valid; `http://` redirects to `https://`.
- [ ] Security headers present (`curl -sI https://<domain>/`): Content-Security-Policy,
      Strict-Transport-Security, X-Content-Type-Options.
- [ ] Register a test organization, upload a document: it is scanned, then visible to the
      organization only. Upload the EICAR test file: it is refused.
- [ ] Verification, invitation and password-reset emails arrive and are not marked as spam.
- [ ] A first backup taken **and restored on another machine** (see the runbook).
- [ ] Monitoring alerts on: health endpoint down, disk above 80 %, backup older than 26 hours,
      certificate expiring within 14 days.

## 6. Known limits of this layout

- One API instance. Rate limits are kept in memory, so they are per instance; running several
  instances needs a shared store (Redis) for them first.
- PostgreSQL and MinIO on the same host as the application: fine to start, but a hardware
  failure means restoring from the last backup (up to 24 hours of data). A managed database
  with point-in-time recovery removes that window.
