# Omnia

A Discord-style real-time chat application built on [SpacetimeDB](https://spacetimedb.com). Servers, channels, threads, roles, and live multiplayer state — no REST API, no WebSocket boilerplate.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8 (Rolldown) + TypeScript 6 |
| Backend | SpacetimeDB 2.1 (TypeScript module) |
| Styling | Plain CSS with CSS custom properties |
| Linting / Formatting | Biome 2 |
| Testing | Vitest 4 + React Testing Library + jsdom |
| Package manager | Bun 1.3+ |

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

- [Bun](https://bun.sh) ≥ 1.3
- [SpacetimeDB CLI](https://spacetimedb.com/docs/getting-started) (`spacetime`)

### Local development

```bash
# 1. Install dependencies
bun install

# 2. Copy environment template and fill in your values
cp .env.local.example .env.local

# 3. Create your SpacetimeDB CLI config (gitignored — each developer has their own)
cat > spacetime.json << 'EOF'
{
  "dev": { "run": "bun run dev" },
  "server": "maincloud",
  "database": "your-database-name",
  "module-path": "./spacetimedb"
}
EOF

# 4. Start the SpacetimeDB server locally (optional — skip to use maincloud)
spacetime start

# 5. Publish the backend module
bun run spacetime:publish:local   # local
# or
bun run spacetime:publish         # maincloud

# 6. Regenerate client bindings after any backend change
bun run spacetime:generate

# 7. Start the dev server
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
├── spacetime.json                # SpacetimeDB CLI config (gitignored — create locally)
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

## Admin Impersonation (break-glass dev access)

Omnia ships with a secure "break-glass" mechanism for developers to claim
`super_admin` privileges on any deployment by entering a shared secret.
It exists so that:

- You can recover admin rights after a `spacetime publish --delete-data`
- Multiple developers can share one deployment without giving each of them
  hardcoded super-admin rows in the module source
- Every elevation is logged to an append-only audit table that super admins
  can read live via subscription

### How it works

```
  Ctrl/Cmd+Shift+A         →  DevAdminModal opens
  enter shared secret      →  claim_super_admin reducer
  secret matches           →  super_admin row inserted for your identity
  SuperAdminBanner appears →  red pulsing banner at top of app
  click Exit               →  revoke_super_admin_self drops the row
```

The shared secret lives in a **private** SpacetimeDB table
(`dev_admin_secret`) that is never synced to any client — it's only ever
read from within the module when a reducer runs. The plaintext never leaves
the server.

### Bootstrapping a fresh deployment

1. Publish the module. Someone (anyone) must immediately seed the secret
   before anyone else races to do it — this is the weak point, but it's a
   one-time step at deploy time.
2. Open the frontend → `Ctrl/Cmd+Shift+A` → modal detects the secret
   isn't seeded yet and switches to "Seed" mode → pick a ≥16-character
   secret → click **Seed & continue**.
3. From now on the guard is closed: re-seeding fails.

### Recovering super-admin after a wipe

Same shortcut, same modal, enter the secret in "Claim" mode, done. Your
identity is added to `super_admin` and the banner flips on.

### Rotating the secret

Open the modal while already super admin → the "Rotate secret" section
appears below the claim form → enter a new secret → click **Rotate**.
Future claimers need the new value.

### Rate limiting

`claim_super_admin` counts failed attempts in `dev_admin_audit` over the
last 60 s. If any single identity accumulates ≥5 failures in that window,
further attempts are rejected for another minute. This is a simple but
effective defence against an attacker who discovered the endpoint but
doesn't have the secret.

### UI indicators

| Element | Where | When |
|---|---|---|
| Red/orange sticky banner | Top of the entire app | Whenever your identity has a `super_admin` row |
| Pulsing white dot | Inside the banner | Always (animation) |
| **Exit** button | Right side of banner | Confirms, then calls `revoke_super_admin_self` |

### Autonomous verification

`ai-bot/src/verify-admin.ts` exercises all 14 scenarios end-to-end against
the live database without needing the frontend:

```bash
cd ai-bot && bun --env-file=../.env.local run src/verify-admin.ts
```

Prints the full `dev_admin_audit` trail at the end.

### Schema reference

| Table | Visibility | Purpose |
|---|---|---|
| `dev_admin_secret` | **private** | Single-row secret holder; never synced to clients |
| `dev_admin_audit` | public | Append-only log of every action |

| Reducer | Who may call | Notes |
|---|---|---|
| `seedDevAdminSecret` | Anyone while table is empty | One-shot bootstrap |
| `rotateDevAdminSecret` | Super admin only | Re-key the shared secret |
| `claimSuperAdmin` | Anyone who knows the secret | Rate-limited, idempotent |
| `revokeSuperAdminSelf` | Current super admin | Drops your own row |

## AI assistant (`/ask`)

Omnia ships with a RAG-based documentation assistant: type `/ask <question>`
in any channel and a sidecar bot answers with citations grounded in that
server's messages.

### Architecture

```
  User types /ask foo
        │
        ▼
  createAskRequest reducer  ─────────────►  SpacetimeDB (ask_request: pending)
                                                     │
                                                     │ (subscription)
                                                     ▼
                                           ┌──────────────────┐
                                           │   ai-bot (Bun)   │
                                           │                  │
                                           │  1. embed Q      │───► LLM (embeddings)
                                           │  2. vector search│───► Qdrant
                                           │  3. fetch msgs   │◄─── local SpacetimeDB cache
                                           │  4. chat compl.  │───► LLM (chat)
                                           │  5. sendMessage  │───► SpacetimeDB
                                           │  6. resolveAsk   │───► SpacetimeDB
                                           └──────────────────┘
```

The bot is a separate sub-package (`ai-bot/`) — it does **not** run inside
the SpacetimeDB module (SpacetimeDB reducers are deterministic and can't
call external APIs). Instead, it connects as a normal SpacetimeDB user and
uses the public reducer/subscription API like any other client.

### Setup

1. **Deploy [Qdrant](https://qdrant.tech)** — I run mine via Dokploy at
   `https://qdrant.example.com` with API-key auth.

2. **Pick an LLM provider:**
   - **OpenAI** — uses `text-embedding-3-small` + `gpt-4o-mini`, pay-as-you-go
   - **Google Gemini** — uses `gemini-embedding-001` + `gemini-2.5-flash`,
     has a generous free tier

3. **Fill in `.env.local`** (reuse the frontend's file so both share creds):
   ```env
   AI_PROVIDER=gemini
   QDRANT_URL=https://qdrant.yourhost.com
   QDRANT_API_KEY=…
   QDRANT_COLLECTION=omnia_messages
   GOOGLE_GENERATIVE_AI_API_KEY=…
   # or: OPENAI_API_KEY=sk-…
   ```

4. **Install bot deps:**
   ```bash
   cd ai-bot && bun install
   ```

5. **Run the smoke test** to verify the LLM + Qdrant path before booting:
   ```bash
   bun --env-file=../.env.local run src/smoke.ts
   ```

6. **Start the bot:**
   ```bash
   bun run start
   ```
   On first boot it creates the Qdrant collection, mints its SpacetimeDB
   identity, and persists the auth token to `.bot-token` for future runs.

7. **Enable AI on a server** — open the server in the frontend, go to
   **Server Settings → Apps → AI Assistant**, toggle both switches, set a
   token budget, and save. The bot immediately runs backfill over that
   server's existing messages and goes live.

8. **Type `/ask <question>`** in any channel. The bot will post a grounded
   answer with inline citations within a few seconds.

### Bot verification scripts

Two helpers live under `ai-bot/src/`:

| Script | Purpose |
|---|---|
| `smoke.ts` | Exercises embed → Qdrant upsert → vector search → chat completion. Runs without touching SpacetimeDB. Takes ~5 s. |
| `verify.ts` | Connects to the live DB, prints a state report (ai_configs, message counts, ask_requests, audit, Qdrant point counts), and runs reducer validation tests (empty/long/invalid questions). |
| `verify-e2e.ts` | Posts real questions and prints the bot's answers so you can eyeball RAG quality. |

Run any of them with:
```bash
cd ai-bot && bun --env-file=../.env.local run src/smoke.ts
```

### Schema additions

The following tables and reducers were added to support AI features:

| Table | Purpose |
|---|---|
| `ai_config` | Per-server feature flags + monthly token budget |
| `ask_request` | Pending/answered/failed RAG requests |
| `ai_audit` | Token usage log (user, feature, cost) |

| Reducer | Caller | Purpose |
|---|---|---|
| `ensureAiConfig` | anyone | Idempotent default-row bootstrap |
| `updateAiConfig` | server admin | Toggle features, set budget |
| `createAskRequest` | any member | Submit a question, creates pending row |
| `resolveAskRequest` | bot | Mark as answered, log tokens |
| `failAskRequest` | bot | Mark as failed with error message |

## Deployment

The frontend is a static Vite SPA. Build it with:

```bash
VITE_SPACETIMEDB_HOST=https://maincloud.spacetimedb.com \
VITE_SPACETIMEDB_DB_NAME=your-database-name \
bun run build
```

Serve the `dist/` folder with any static host (nginx, Caddy, Vercel, Netlify,
Cloudflare Pages, etc.). A `Dockerfile` and `docker/nginx.conf` are included
if you prefer a container.

The backend module is published separately:

```bash
bun run spacetime:publish    # publish to maincloud
bun run spacetime:generate   # regenerate client bindings after schema changes
```

The AI bot (`ai-bot/`) is a long-running Bun process — run it wherever you
like (VPS, container, managed hosting). See the [AI assistant](#ai-assistant-ask)
section for setup details.

## License

ISC
