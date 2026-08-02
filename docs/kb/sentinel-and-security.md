# Sentinel and Security

OpenSteam runs automated security (Sentinel) to protect manifests, API, and the community from abuse.

## What Sentinel does

- **Rate limiting** — daily, hourly, and per-minute API limits per plan
- **Risk scoring** — unusual patterns may trigger short jails
- **IP firewall** — persistent abusers can be IP-blacklisted (admin action)
- **Verification checks** — VPN/proxy block, alt signals, connection blacklists
- **Scraper detection** — aggressive automated access may be throttled

## Rate limits vs bans

| Type | Duration | Typical cause |
|------|----------|---------------|
| **429 rate limit** | Until reset window | Normal quota exceeded |
| **Temporary jail** | Short (e.g. ~30 seconds) | Burst abuse, risk spike |
| **Account suspension** | Until staff review | Repeated abuse, Discord softban linkage |
| **IP blacklist** | Permanent | Admin firewall ban |

Hitting a rate limit is **not** the same as being banned.

## Sentinel shop (Discord)

Users can spend **coins** on cosmetic/security perks in the Discord shop:

- `/shop` — view Sentinel Cosmetic Perk Shop
- `/buy` — purchase perks (e.g. visible color roles, shields)

**Sentinel Shields** (documented in onboarding): shop item that can block certain automated scan/jail flags for a period. Details are in shop catalog — not a bypass for manual staff bans.

## Verification security

- VPN/proxy blocked at verify time
- Browser fingerprint and canvas checks may be collected during verify
- Blacklisted Discord friends/servers block verification until removed

## API security tips

- Rotate exposed keys immediately
- Use backoff on 429 responses
- High-volume legitimate users may request **security bypass** status from staff (not guaranteed)

## Platform ↔ Discord linkage

Leaving the OpenSteam Discord server or receiving certain Discord punishments may affect web/API access. Re-verify or contact support if access is wrongly revoked.

## What to tell users who feel "flagged unfairly"

1. Check `/status` and dashboard for jail/ban state
2. Stop rapid automated retries
3. Disable VPN if verifying
4. Open support ticket with timestamp and what you were doing

Atis cannot remove jails, clear risk scores, or unban accounts.
