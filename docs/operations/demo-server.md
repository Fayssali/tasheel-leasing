# Demo server (tasheellease.dz)

A public demonstration of Tasheel with **fictional data only**, on one small VPS
(AYRADE Cloud VPS 1 DZ: 1 vCPU, 4 GB RAM, 200 GB SSD). Same images as production, started
with `DEMO_MODE=true`: every page shows a "demonstration, fictional data" banner.

## Differences from production

|        | Demo                                                                          | Production                   |
| ------ | ----------------------------------------------------------------------------- | ---------------------------- |
| Data   | fictional demo organizations, products, quotations, applications, commissions | reference data only          |
| Emails | caught by Mailpit, readable at `/mail/` (password-protected), never delivered | real SMTP provider           |
| Banner | "Démonstration — données fictives" on every page                              | none                         |
| Size   | 1 vCPU, 4 GB RAM + 4 GB swap                                                  | see the deployment checklist |

Do not enter real company documents or personal data on the demo server.

## Before running the installer

1. **DNS:** in the AYRADE panel, an `A` record for `tasheellease.dz` pointing to the VPS
   public IPv4. The installer checks it before requesting the HTTPS certificate.
2. **VPS:** Debian 12 or Ubuntu 22.04/24.04, root access, Docker allowed, ports 80 and 443
   reachable.
3. **Image access:** a GitHub token (classic) with only the `read:packages` scope, from an
   account that can read `Fayssali/tasheel-leasing`. Images are published by CI from `main`.

## Install

```sh
export DOMAIN=tasheellease.dz GHCR_USER=<github user> GHCR_TOKEN=<token>
bash install.sh        # infra/demo/install.sh, copied to the server
```

First run: about 15–25 minutes (image download, antivirus signatures). At the end it prints
the URL, the demo accounts and their common password, and the Mailpit password. Secrets are
generated on the server in `/opt/tasheel-demo/.env`.

Bank and Tasheel admin accounts must set up two-step verification at first sign-in, as in
production: have an authenticator app ready before a live demo.

## Operate

```sh
cd /opt/tasheel-demo
docker compose ps                     # health of every service
docker compose logs --tail 100 api    # API log (JSON lines)
VERSION=main bash install.sh          # update to the latest images (data kept)
```

Reset to fresh demo data: `docker compose down -v && rm .seeded && bash install.sh`
(erases everything on the demo server, including accounts created during demos).
