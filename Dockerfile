# syntax=docker/dockerfile:1.7

# =============================================================================
#  Omnia — multi-stage Dockerfile
#
#  This repo only ships the Vite SPA as a container. The SpacetimeDB backend
#  runs on SpacetimeDB maincloud (https://maincloud.spacetimedb.com) and is
#  published via `bun run spacetime:publish` from CI or locally — NOT from
#  inside this image.
#
#  Stages:
#    1. builder — Bun + Vite build
#    2. runtime — nginx serving the built SPA (final target)
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: builder
# -----------------------------------------------------------------------------
FROM oven/bun:1.2-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies first — cached until package.json or bun.lock changes.
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Copy full source.
COPY . .

# Vite bakes VITE_* env vars at build time — pass them as build args.
ARG VITE_SPACETIMEDB_HOST
ARG VITE_SPACETIMEDB_DB_NAME
ENV VITE_SPACETIMEDB_HOST=${VITE_SPACETIMEDB_HOST}
ENV VITE_SPACETIMEDB_DB_NAME=${VITE_SPACETIMEDB_DB_NAME}

RUN bun run build


# -----------------------------------------------------------------------------
# Stage 2: runtime — nginx serving the built SPA
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl

# Replace the default nginx config with ours (SPA fallback, gzip, caching).
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Ship only the built assets — no source, no node_modules, no secrets.
COPY --from=builder /app/dist /usr/share/nginx/html

# Run nginx as a non-root user (image already has the 'nginx' user).
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
  && touch /var/run/nginx.pid \
  && chown nginx:nginx /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
