# Atis Knowledge Base Index

Articles for **Atis**, the OpenSteam knowledge-base assistant. Atis answers only from these sources plus linked platform docs.

## User guides

| Article | Topics |
|---------|--------|
| [getting-started.md](./getting-started.md) | First login, verify, `/gen`, where to find things |
| [discord-verification.md](./discord-verification.md) | Verify flow, VPN block, blacklist, re-verify |
| [discord-bot-commands.md](./discord-bot-commands.md) | `/gen`, `/request`, shop, admin commands |
| [dashboard-and-api-keys.md](./dashboard-and-api-keys.md) | Dashboard tabs, creating keys, hygiene |
| [hosted-bots.md](./hosted-bots.md) | Branded vs custom bot, `/link`, manager offline |
| [telegram-bot-integration.md](./telegram-bot-integration.md) | Telegram linking, quotas, commands, promos |

## Plans & API

| Article | Topics |
|---------|--------|
| [plans-and-limits.md](./plans-and-limits.md) | Tiers, quotas, upgrades, hosted eligibility |
| [manifest-structure-and-file-formats.md](./manifest-structure-and-file-formats.md) | Main `.lua` file vs optional `.manifest` files |
| [learned-staff-insights.md](./learned-staff-insights.md) | Dynamic staff solutions learned from tickets |
| [api-troubleshooting.md](./api-troubleshooting.md) | 401/403/429, endpoints, headers |
| [api-v2-migration-guide.md](./api-v2-migration-guide.md) | Header auth, Reseller endpoints, v1 deprecation |

## Platform & support

| Article | Topics |
|---------|--------|
| [sentinel-and-security.md](./sentinel-and-security.md) | Rate limits, jails, shields, abuse |
| [support-and-escalation.md](./support-and-escalation.md) | Tickets, AI agent, human escalation |
| [forge-marketplace.md](./forge-marketplace.md) | Script uploads, moderation, pending state |
| [admin-dashboard-guide.md](./admin-dashboard-guide.md) | Verification queue, Telegram tracking, roles |
| [system-architecture-fallbacks.md](./system-architecture-fallbacks.md) | Ryuu-first hierarchy, LLMs, fallback layers |

## External references (repo root)

- `API_DOCUMENTATION.md` — full developer API
- `API_ACTIVATION.md` — Windows app activation
- `README.md` — platform overview
- Steam account shop: [gamegen.mysellauth.com](https://gamegen.mysellauth.com/) (`/shop` redirects there)

## Website routes

- http://127.0.0.1:3000 — home / web gen
- http://127.0.0.1:3000/pricing — plans
- http://127.0.0.1:3000/docs — developer docs UI
- http://127.0.0.1:3000/dashboard — user dashboard
- http://127.0.0.1:3000/verify — verification page (session link only)
- http://127.0.0.1:3000/incidents — status / outages

## Discord

- Official server: join via site or https://discord.gg/yKyKhSNGKz
- Verification: verify channel → **Verify** button
