# Plans and Limits

OpenSteam uses tiered plans for web generation, API access, and hosted bots.

## Plan overview

| Plan | Web / day | API / day (per key) | Hosted bot |
|------|-----------|---------------------|------------|
| **Free** | 25 | 50 | — |
| **Regular** | 100 | 1,000 | Branded |
| **Premium** | 500 | 5,000 | Branded + webhooks |
| **Reseller** | 1,500 | 30,000 | Custom + bulk API |
| **Business** | 3,000 | 100,000 | Custom |
| **Custom** | 10,000 | 1,000,000+ | Custom (admin-set) |

## What each tier is for

- **Free** — try the platform, light Discord `/gen`, no commercial API scale
- **Regular / Premium** — personal or small-scale use, branded bot in your server
- **Reseller / Business** — commercial volume, custom bot, bulk API
- **Custom** — negotiated limits for large operators

## API rate limits (summary)

In addition to daily quotas, the API enforces hourly and per-minute (burst) limits. See API documentation for full tables.

**Free tier note:** Ryuu and Morrenus upstream auto-generation is **on by default** for uncached games. Paid tiers have upstream off unless staff enable overrides.

## Web generation limits

- Counted per account per day
- Visible on the home page and dashboard when signed in
- Resets daily (UTC-based server schedule)

## Upgrading

1. Visit **http://127.0.0.1:3000/pricing**
2. Complete checkout via **Pandabase**
3. Sign out and back in if plan does not update immediately
4. Plans do not auto-renew unless purchased through Pandabase subscription flow

## Hosted bot eligibility

| Plan | Bot type |
|------|----------|
| Free | None |
| Regular, Premium | **Branded** shared OpenSteam bot |
| Reseller, Business | **Custom** bot (your Discord app credentials) |

**Important:** Reseller/Business users must use **Custom Bot**, not the branded bot tab. Free users must upgrade to Regular or Premium for branded hosting.

## Business plan expiry

Business plans can expire or be canceled. If expired, hosted bot and plan features may stop until renewed.

## When you hit a limit

- **Web:** wait for daily reset or upgrade
- **API 429:** daily, hourly, or burst limit — check response headers (`X-RateLimit-*`) and `/api/{key}/usage`
- **Temporary jail:** short cooling period after abuse signals — not necessarily a ban

## Staff plans

Admins, moderators, and owners may have elevated access. This is not a public purchasable tier.

## Billing questions

Atis cannot change plans or issue refunds. Open a **support ticket** for billing disputes or manual plan adjustments.
