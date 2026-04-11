# Omnia

A Discord-style real-time chat application built on [SpacetimeDB](https://spacetimedb.com). Servers, channels, threads, roles, and live multiplayer state — no REST API, no WebSocket boilerplate.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 7 + TypeScript 5.6 |
| Backend | SpacetimeDB 2.1 (TypeScript module) |
| Styling | Plain CSS with CSS custom properties |
| Linting / Formatting | Biome 2 |
| Testing | Vitest + React Testing Library |
| Package manager | Bun |

## Features

- **Servers & channels** — create servers, organise channels into categories, manage positions
- **Real-time messaging** — send, edit, delete, and pin messages; live delivery via SpacetimeDB subscriptions
- **Threads** — branch any message into a side thread
- **Reactions** — emoji reactions with live counts
- **Typing indicators** — per-channel "X is typing…" with TTL
- **Unread badges** — read-state tracking per channel
- **Roles & permissions** — per-server roles with bitflag permissions (Send Messages, Administrator); server owners always have full access
- **Invite system** — shareable `/invite/:code` links with configurable expiry and max-uses; or send a direct invite notification to any user
- **Notifications** — in-app bell with join/dismiss for server invite notifications
- **Slowmode** — per-channel rate limiting enforced on the backend
- **User profiles** — display name, avatar colour, bio, status (Online / Idle / DND / Invisible)
- **Server nicknames** — per-server display name override
- **Super admin panel** — platform-wide moderation and role management
- **Markdown** — messages rendered via react-markdown + remark-gfm

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [SpacetimeDB CLI](https://spacetimedb.com/docs/getting-started) (`spacetime`)

### Local development

```bash
# 1. Install dependencies
bun install

# 2. Copy environment template and fill in your values
cp .env.local.example .env.local

# 3. Start the SpacetimeDB server locally (optional — skip to use maincloud)
spacetime start

# 4. Publish the backend module
bun run spacetime:publish:local   # local
# or
bun run spacetime:publish         # maincloud

# 5. Regenerate client bindings after any backend change
bun run spacetime:generate

# 6. Start the dev server
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Environment variables

Create `.env.local` in the project root (see `.env.local` for the full list):

```env
VITE_SPACETIMEDB_HOST=https://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DB_NAME=your-database-name
```

| Variable | Description |
|----------|-------------|
| `VITE_SPACETIMEDB_HOST` | SpacetimeDB server URL (`ws://localhost:3000` for local) |
| `VITE_SPACETIMEDB_DB_NAME` | Database / module name |

## Project structure

```
omnia/
├── src/
│   ├── components/
│   │   ├── Chat.tsx              # Message list, input, threads, reactions
│   │   ├── Sidebar.tsx           # Server rail, channel panel, invite modal, notifications
│   │   ├── Members.tsx           # Right-side member list
│   │   ├── MessageText.tsx       # Markdown renderer
│   │   ├── UserProfile.tsx       # Profile popover + edit modal
│   │   ├── ServerSettings.tsx    # Admin panel (roles, members, invites, channels)
│   │   └── SuperAdminPanel.tsx   # Platform-wide moderation
│   ├── hooks/
│   │   └── useRoute.ts           # Lightweight History API router
│   ├── utils/
│   │   └── alias.ts              # Deterministic display-name generator
│   ├── module_bindings/          # Auto-generated — do not edit manually
│   ├── App.tsx                   # Root component, subscriptions, permission logic
│   └── main.tsx                  # SpacetimeDB provider + connection bootstrap
├── spacetimedb/
│   └── src/index.ts              # Backend: tables, reducers, lifecycle hooks
├── biome.json                    # Biome lint + format config
├── spacetime.json                # SpacetimeDB CLI config
└── vite.config.ts
```

## Scripts

```bash
bun run dev               # Start Vite dev server
bun run build             # Type-check + production build
bun run preview           # Preview production build locally
bun run test              # Run Vitest test suite

bun run lint              # Lint with Biome
bun run format            # Format with Biome
bun run check             # Lint + format + import sort (dry run)
bun run check:fix         # Apply all safe fixes
bun run ci                # Strict CI check (used in pipelines)

bun run spacetime:generate        # Regenerate src/module_bindings/ from backend
bun run spacetime:publish         # Publish backend to maincloud
bun run spacetime:publish:local   # Publish backend to local SpacetimeDB
```

## Backend development

The SpacetimeDB module lives in `spacetimedb/src/index.ts`. It defines all tables and reducers in TypeScript and is compiled + published to SpacetimeDB (not a Node.js server).

After editing the backend:

```bash
# Republish (preserves data)
spacetime publish --module-path spacetimedb

# Republish and clear all data
spacetime publish --clear-database -y --module-path spacetimedb

# Regenerate client bindings
bun run spacetime:generate
```

View live server logs:

```bash
spacetime logs your-database-name
```

## Self-hosting with Dokploy

Omnia ships with a production-ready `docker-compose.yml` designed for
[Dokploy](https://dokploy.com). It runs three services on your VPS:

| Service | Image / Build | Purpose |
|---------|---------------|---------|
| `spacetimedb` | `clockworklabs/spacetime:latest` | Self-hosted SpacetimeDB server (persistent data in a named volume) |
| `publisher` | Multi-stage build (`publisher` target) | One-shot container that publishes the module on every deploy |
| `frontend` | Multi-stage build (`runtime` target) | nginx serving the Vite-built SPA |

### Architecture

```
         Traefik (Dokploy-managed)
              │        │
   omnia.domain       db.omnia.domain
              │        │
        ┌─────┴─┐  ┌───┴────┐
        │frontend│  │spacetimedb│──► stdb-data (named volume)
        └────────┘  └───────────┘
                         ▲
                   publisher (one-shot, on each deploy)
```

### One-time setup

1. In Dokploy, create a new **Docker Compose** application pointed at this repo.
2. Go to **Environment** and paste the contents of `.env.docker.example`, replacing the example values with your domains:
   ```env
   DOMAIN=chat.yourdomain.com
   DB_DOMAIN=db.chat.yourdomain.com
   VITE_SPACETIMEDB_HOST=wss://db.chat.yourdomain.com
   VITE_SPACETIMEDB_DB_NAME=omnia
   ```
3. Point both subdomains' DNS at your Dokploy server.
4. Deploy. Dokploy will `git clone`, build images, and start the stack. On first boot, the `publisher` container waits for SpacetimeDB's healthcheck, then publishes the module.
5. Open `https://<DOMAIN>` — Traefik serves the SPA and upgrades WebSocket connections to `<DB_DOMAIN>`.

### Why named volumes (not bind mounts)

Dokploy performs a fresh `git clone` of the repo on every deploy, which wipes any files mounted relative to the repo. The compose file uses a **named Docker volume** (`stdb-data`) for SpacetimeDB data, which survives redeploys and is compatible with Dokploy's **Volume Backups** feature (S3, B2, R2, GCS).

### Vite env vars are baked at build time

`VITE_SPACETIMEDB_HOST` and `VITE_SPACETIMEDB_DB_NAME` are compiled into the JS bundle — they're passed as Docker **build args**, not runtime env. If you change them, Dokploy must rebuild the `frontend` image.

### Production recommendation (CI/CD)

Per [Dokploy's Going Production guide](https://docs.dokploy.com/docs/core/applications/going-production), building on the production server can starve resources. For high-traffic deployments, build images in CI/CD (GitHub Actions, etc.), push to a registry (GHCR / Docker Hub), and replace the `build:` directives in `docker-compose.yml` with `image:` tags. The compose file is structured so this swap is mechanical.

### Local smoke test

You can validate the stack on your machine before deploying:

```bash
docker compose config   # lint the compose file
docker compose build    # build all images
# Add dokploy-network externally so the compose file validates:
docker network create dokploy-network
docker compose up -d
```

## License

ISC
