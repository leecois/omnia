# syntax=docker/dockerfile:1.7

# =============================================================================
#  Omnia — multi-stage Dockerfile
#  Targets:
#    - builder   : installs deps & builds the Vite SPA with Bun
#    - runtime   : nginx serving the built SPA (default target)
#    - publisher : one-shot container that publishes the SpacetimeDB module
#
#  Build examples:
#    docker build --target runtime   -t omnia-frontend .
#    docker build --target publisher -t omnia-publisher .
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: builder — Bun + Vite production build
# -----------------------------------------------------------------------------
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Install dependencies first for optimal layer caching.
# Only invalidated when package.json or bun.lock change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build.
COPY . .

# Vite bakes VITE_* env vars at build time; pass them in via build args.
ARG VITE_SPACETIMEDB_HOST
ARG VITE_SPACETIMEDB_DB_NAME
ENV VITE_SPACETIMEDB_HOST=${VITE_SPACETIMEDB_HOST}
ENV VITE_SPACETIMEDB_DB_NAME=${VITE_SPACETIMEDB_DB_NAME}

RUN bun run build


# -----------------------------------------------------------------------------
# Stage 2: runtime — nginx serving the SPA
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Drop default nginx config and install ours
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets only — no source, no node_modules
COPY --from=builder /app/dist /usr/share/nginx/html

# Run as non-root for defense-in-depth
# (nginx image already ships a 'nginx' user)
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
  && touch /var/run/nginx.pid \
  && chown nginx:nginx /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]


# -----------------------------------------------------------------------------
# Stage 3: publisher — one-shot SpacetimeDB module publisher
# -----------------------------------------------------------------------------
# Pinned to the same major version the client SDK targets (2.x)
FROM clockworklabs/spacetime:latest AS publisher

WORKDIR /module

# Copy only the backend module (keeps image small, avoids frontend leakage)
COPY spacetimedb ./spacetimedb

# The clockworklabs image sets ENTRYPOINT to the spacetime binary.
# Override with a shell so we can expand ${SPACETIMEDB_DB_NAME} at runtime
# and republish the module on every container start.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["spacetime publish \"$SPACETIMEDB_DB_NAME\" \
      --module-path /module/spacetimedb \
      --server http://spacetimedb:3000 \
      -y"]
