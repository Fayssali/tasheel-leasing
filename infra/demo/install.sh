#!/usr/bin/env bash
# Tasheel Leasing — installation of a PUBLIC DEMONSTRATION server (fictional data only).
#
# On a fresh Debian 12 / Ubuntu 22.04+ VPS (tested size: 1 vCPU, 4 GB RAM), as root:
#
#   export DOMAIN=tasheellease.dz            # its A record must point to this server
#   export GHCR_USER=<github user>           # account that can read the images
#   export GHCR_TOKEN=<token>                # GitHub token with the read:packages scope
#   bash install.sh
#
# What it does: firewall (22, 80, 443), 4 GB swap, Docker, then PostgreSQL, MinIO, ClamAV,
# Mailpit (catches every email: nothing leaves the server), the API, the web app and Caddy
# (automatic HTTPS). It loads the reference data and the FICTIONAL demo organizations, and
# prints the demo accounts. Every page shows a "demonstration, fictional data" banner.
# Re-running it is safe: secrets and data are kept; images are updated.
set -euo pipefail

DOMAIN="${DOMAIN:?export DOMAIN=tasheellease.dz}"
GHCR_USER="${GHCR_USER:?export GHCR_USER=<github user>}"
GHCR_TOKEN="${GHCR_TOKEN:?export GHCR_TOKEN=<token with read:packages>}"
REGISTRY="${REGISTRY:-ghcr.io/fayssali}"
VERSION="${VERSION:-main}"
DIR=/opt/tasheel-demo

log() { printf '\n\033[1;34m[tasheel]\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m[tasheel] %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Run as root (sudo -i)."

# ---------------------------------------------------------------- DNS check
log "Checking that $DOMAIN points to this server"
apt-get update -qq && apt-get install -y -qq curl ca-certificates openssl dnsutils ufw >/dev/null
PUBLIC_IP="$(curl -4fsS https://api.ipify.org || true)"
DNS_IP="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -n1)"
echo "  server public IPv4: ${PUBLIC_IP:-unknown}"
echo "  $DOMAIN resolves to: ${DNS_IP:-nothing}"
if [[ -z "$DNS_IP" || "$DNS_IP" != "$PUBLIC_IP" ]] && [[ "${SKIP_DNS_CHECK:-}" != "1" ]]; then
  die "Point the A record of $DOMAIN to ${PUBLIC_IP:-the IP of this server} (AYRADE DNS panel), wait for it to propagate, then re-run. (SKIP_DNS_CHECK=1 to bypass.)"
fi

# ---------------------------------------------------------------- system
log "Firewall: only SSH, HTTP and HTTPS"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if ! swapon --show | grep -q .; then
  log "Adding 4 GB of swap (the antivirus needs headroom on a 4 GB server)"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10; echo 'vm.swappiness=10' > /etc/sysctl.d/99-tasheel.conf
fi

if ! command -v docker >/dev/null; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null

# ---------------------------------------------------------------- files
log "Writing configuration in $DIR"
mkdir -p "$DIR/postgres-init"
cd "$DIR"
umask 077

if [[ ! -f .env ]]; then
  hex() { openssl rand -hex 24; }
  cat > .env <<ENV
DOMAIN=$DOMAIN
REGISTRY=$REGISTRY
VERSION=$VERSION
POSTGRES_SUPERUSER_PASSWORD=$(hex)
TASHEEL_ADMIN_PASSWORD=$(hex)
TASHEEL_APP_PASSWORD=$(hex)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
MINIO_ROOT_USER=tasheel
MINIO_ROOT_PASSWORD=$(hex)
SEED_DEMO_PASSWORD=Demo-$(openssl rand -hex 4)-2026!
MAILPIT_PASSWORD=$(openssl rand -hex 8)
ENV
else
  sed -i "s|^VERSION=.*|VERSION=$VERSION|; s|^REGISTRY=.*|REGISTRY=$REGISTRY|" .env
fi
umask 022

cat > postgres-init/01-roles.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
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
SH
chmod +x postgres-init/01-roles.sh

cat > Caddyfile <<'CADDY'
{$DOMAIN} {
	encode zstd gzip
	# Emails caught by Mailpit (verification, invitations, invoices), password-protected.
	handle /mail* {
		reverse_proxy mailpit:8025
	}
	handle {
		reverse_proxy web:8080 {
			header_up X-Request-Id {http.request.uuid}
		}
	}
	log {
		output stdout
		format json
	}
}
CADDY

cat > docker-compose.yml <<'COMPOSE'
name: tasheel-demo

x-api-env: &api-env
  NODE_ENV: production
  DEMO_MODE: 'true'
  NODE_OPTIONS: --max-old-space-size=384
  API_PORT: 3000
  TRUST_PROXY: 2
  DATABASE_URL: postgresql://tasheel_app:${TASHEEL_APP_PASSWORD}@postgres:5432/tasheel
  DATABASE_URL_ADMIN: postgresql://tasheel_admin:${TASHEEL_ADMIN_PASSWORD}@postgres:5432/tasheel
  WEB_APP_URL: https://${DOMAIN}
  API_CORS_ORIGIN: https://${DOMAIN}
  JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
  MFA_ENCRYPTION_KEY: ${MFA_ENCRYPTION_KEY}
  S3_ENDPOINT: http://minio:9000
  S3_REGION: dz-1
  S3_BUCKET_DOCUMENTS: tasheel-documents
  S3_ACCESS_KEY: ${MINIO_ROOT_USER}
  S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
  SMTP_HOST: mailpit
  SMTP_PORT: 1025
  SMTP_SECURE: 'false'
  MAIL_FROM: Tasheel Leasing (démo) <no-reply@${DOMAIN}>
  SCAN_MODE: clamav
  CLAMAV_HOST: clamav
  CLAMAV_PORT: 3310
  SEED_DEMO_PASSWORD: ${SEED_DEMO_PASSWORD}

services:
  caddy:
    image: caddy:2.8-alpine
    restart: unless-stopped
    ports: ['80:80', '443:443']
    environment: { DOMAIN: '${DOMAIN}' }
    volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy-data:/data']
    depends_on: [web, mailpit]

  web:
    image: ${REGISTRY}/tasheel-web:${VERSION}
    restart: unless-stopped
    depends_on: { api: { condition: service_healthy } }

  api:
    image: ${REGISTRY}/tasheel-api:${VERSION}
    restart: unless-stopped
    environment: *api-env
    mem_limit: 512m
    depends_on:
      migrate: { condition: service_completed_successfully }
      minio-setup: { condition: service_completed_successfully }
      clamav: { condition: service_healthy }

  migrate:
    image: ${REGISTRY}/tasheel-api:${VERSION}
    restart: 'no'
    environment: *api-env
    working_dir: /app/packages/db
    command: ['npx', 'prisma', 'migrate', 'deploy']
    depends_on: { postgres: { condition: service_healthy } }

  # One-off, started by install.sh: reference data + fictional demo data.
  seed:
    image: ${REGISTRY}/tasheel-tools:${VERSION}
    restart: 'no'
    profiles: ['tools']
    environment:
      <<: *api-env
      NODE_ENV: development
    command: ['npx', 'tsx', 'prisma/seed.ts']

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    command: ['postgres', '-c', 'shared_buffers=128MB', '-c', 'max_connections=50']
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD}
      POSTGRES_DB: postgres
      TASHEEL_ADMIN_PASSWORD: ${TASHEEL_ADMIN_PASSWORD}
      TASHEEL_APP_PASSWORD: ${TASHEEL_APP_PASSWORD}
    volumes: ['pgdata:/var/lib/postgresql/data', './postgres-init:/docker-entrypoint-initdb.d:ro']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d tasheel']
      interval: 10s
      timeout: 3s
      retries: 15

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    restart: unless-stopped
    command: server /data
    environment: { MINIO_ROOT_USER: '${MINIO_ROOT_USER}', MINIO_ROOT_PASSWORD: '${MINIO_ROOT_PASSWORD}' }
    volumes: ['miniodata:/data']

  minio-setup:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    restart: 'no'
    environment: { MINIO_ROOT_USER: '${MINIO_ROOT_USER}', MINIO_ROOT_PASSWORD: '${MINIO_ROOT_PASSWORD}' }
    entrypoint: ['/bin/sh', '-c']
    command:
      - >-
        until mc alias set local http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD"; do sleep 2; done
        && mc mb --ignore-existing local/tasheel-documents
        && mc anonymous set none local/tasheel-documents
    depends_on: [minio]

  clamav:
    image: clamav/clamav:stable
    restart: unless-stopped
    volumes: ['clamav-db:/var/lib/clamav']
    healthcheck:
      test: ['CMD', 'clamdcheck.sh']
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 600s

  mailpit:
    image: axllent/mailpit:v1.21
    restart: unless-stopped
    environment:
      MP_WEBROOT: /mail/
      MP_UI_AUTH: demo:${MAILPIT_PASSWORD}
      MP_SMTP_AUTH_ACCEPT_ANY: '1'
      MP_SMTP_AUTH_ALLOW_INSECURE: '1'
      MP_MAX_MESSAGES: '2000'

volumes:
  pgdata:
  miniodata:
  clamav-db:
  caddy-data:
COMPOSE

# ---------------------------------------------------------------- start
log "Signing in to the image registry"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null

log "Downloading images ($VERSION)"
docker compose pull -q
docker compose --profile tools pull -q seed

log "Starting the database, storage, antivirus and mail catcher"
docker compose up -d postgres minio mailpit clamav
docker compose run --rm minio-setup
docker compose run --rm migrate

if [[ ! -f .seeded ]]; then
  log "Loading reference data and FICTIONAL demo organizations"
  docker compose --profile tools run --rm seed
  touch .seeded
fi

log "Starting the API, the web app and HTTPS (the antivirus can take ~10 minutes the first time)"
docker compose up -d
for i in $(seq 1 90); do
  if curl -fsS "https://$DOMAIN/api/v1/health" 2>/dev/null | grep -q '"database":"up"'; then ok=1; break; fi
  sleep 10
done
[[ "${ok:-}" == 1 ]] || die "Not reachable yet. Check: cd $DIR && docker compose ps && docker compose logs --tail 50 api caddy clamav"

set -a; . ./.env; set +a
cat <<DONE

  ✅  Démo en ligne : https://$DOMAIN

  Comptes de démonstration (mot de passe commun : $SEED_DEMO_PASSWORD)
    admin@demo.tasheel.local         équipe Tasheel (double authentification à la 1re connexion)
    banque@demo.tasheel.local        établissement financier (double authentification à la 1re connexion)
    fournisseur@demo.tasheel.local   fournisseur (Atlas Machines)
    fournisseur3@demo.tasheel.local  fournisseur (équipement médical)
    entreprise@demo.tasheel.local    entreprise
    entreprise2@demo.tasheel.local   entreprise avec un dossier de financement et des propositions

  E-mails capturés : https://$DOMAIN/mail/   (utilisateur demo / $MAILPIT_PASSWORD)

  Secrets : $DIR/.env (à conserver ; ne pas partager)
DONE
