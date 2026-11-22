# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t tasheel-api .
# The same image runs the API (default command) and the database migrations
# (command: pnpm --filter @tasheel/db migrate:prod), so both always use the same code.

FROM node:22-bookworm-slim AS base
# OpenSSL is needed by the Prisma query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# ---- build: full install, compile api and the packages it uses ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@tasheel/api...

# ---- runtime: production dependencies + compiled output only ----
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/db/prisma packages/db/prisma
RUN pnpm install --frozen-lockfile --prod --filter=@tasheel/api... \
 && pnpm --filter @tasheel/db exec prisma generate \
 && pnpm store prune
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/i18n/locales packages/i18n/locales

USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- tools: one-off administration commands (reference data, demo data, first admin) ----
# Not a server image: it keeps the development dependencies the seed scripts need.
#   docker run --rm --env-file … tasheel-tools                      → reference data only
#   docker run --rm --env-file … tasheel-tools npx tsx prisma/seed.ts   → full demo data
#   docker run --rm -it --env-file … tasheel-tools npx tsx scripts/create-platform-admin.ts
FROM build AS tools
WORKDIR /app/packages/db
CMD ["npx", "tsx", "prisma/seed.ts", "--catalogue-only"]
