# Web image: the built single-page app served by Nginx, which also forwards /api to the API
# container so the browser sees one origin (the refresh cookie is SameSite=Strict).
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t tasheel-web .

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Relative API path: same origin, nothing environment-specific is baked into the bundle.
ENV VITE_API_URL=/api/v1
RUN pnpm turbo run build --filter=@tasheel/web...

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY infra/production/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
