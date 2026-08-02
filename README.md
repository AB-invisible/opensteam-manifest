# OpenSteam Manifests

A full-stack SaaS platform for Steam manifest generation, delivery, and automation — built on Next.js 14, PostgreSQL, and Discord.

## Platform Overview

OpenSteam Manifests provides:

- **Web generation** — Search by Steam App ID or game name, download JSON/Lua/ZIP manifests
- **Developer API** — Path-based API keys (`/api/{apiKey}/generate/{appId}`)
- **Discord verification** — Guild membership + OAuth verification before platform access
- **Community Discord bot** — `/gen`, `/drop`, moderation, and verification flows
- **Hosted bots** — Branded (Regular/Premium) and custom (Reseller+) bots for your server
- **Forge** — User script marketplace with automated + AI moderation
- **Billing** — Pandabase integration with tiered plans (Free → Custom)
- **Admin tooling** — Users, manifests, incidents, hosted bots, moderation, and more

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript, Node 22 |
| Database | PostgreSQL + Prisma |
| Auth | NextAuth (Discord OAuth) |
| UI | React 18, Tailwind CSS, Radix UI |
| Storage | Local volume / Railway + AWS S3 |
| Bots | discord.js (community + hosted daemons) |
| Payments | Pandabase |
| Observability | OpenTelemetry → Better Stack |

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL
- Discord Application (OAuth2 + Bot)
- Optional: Steam API key, AWS S3, Pandabase, Groq/Gemini for LLM features

### Installation

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL, DISCORD_*, NEXTAUTH_*, STORAGE_PATH, etc.
npx prisma generate
npx prisma migrate deploy   # production
# npx prisma db push        # local dev only
npm run dev
```

### Production startup

```bash
npm run start
```

Runs: Ollama setup → DB wait → enum fix → **prisma migrate deploy** → forge sync → bot ensure → hosted bots → `next start`.

### Background processes

```bash
npm run bot          # Community Discord bot daemon
npm run hosted-bots  # Hosted branded/custom bot manager
npm run sync-s3      # S3 manifest sync
```

## Key Routes

| Area | Path |
|------|------|
| Home / generate | `/` |
| Dashboard | `/dashboard` |
| Admin | `/admin` |
| Discord verify | `/verify` |
| API docs | `/docs` |
| OpenAPI spec | `/api/openapi` |
| Pricing | `/pricing` |

## API

Authentication uses your API key in the URL path:

```
GET http://127.0.0.1:3000/api/{YOUR_API_KEY}/generate/{appId}
GET http://127.0.0.1:3000/api/{YOUR_API_KEY}/download/{appId}
POST http://127.0.0.1:3000/api/{YOUR_API_KEY}/request/{appId}
POST http://127.0.0.1:3000/api/{YOUR_API_KEY}/bulk/generate  # Reseller+
```

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) and `/api/openapi` for the full spec.

## Plans

| Plan | Web daily | API daily | Hosted bot |
|------|-----------|-----------|------------|
| Free | 25 | 50 | — |
| Regular | 100 | 1,000 | Branded |
| Premium | 500 | 5,000 | Branded + webhooks |
| Reseller | 1,500 | 30,000 | Custom + bulk API |
| Business | 3,000 | 100,000 | Custom |
| Custom | 10,000 | 1,000,000 | Custom |

## Operator Notes

- **Run without your PC** — [docs/FREE-HOSTING.md](./docs/FREE-HOSTING.md) (Neon + Fly/Oracle) · **Bot only:** [docs/WISPBYTE.md](./docs/WISPBYTE.md)
- **Verification funnel** — Admin → Discord config → Load audit log (metrics + sessions)
- **Maintenance** — `POST /api/admin/maintenance/run` (OWNER); health checks, scaling, drop cleanup
- **Health checks** — DB, storage, bot daemon, hosted bots, upstream Morrenus/Ryuu
- **Forge moderation** — Heuristic + LLM Pass 4; public scripts may enter `PENDING` for staff review

## Testing

```bash
npm test
```

Vitest covers Forge moderation heuristics and manifest filename utilities.

## Documentation

- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — Developer API reference
- [.env.example](./.env.example) — Full environment variable surface
