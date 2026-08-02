# Getting Started with OpenSteam

OpenSteam (gamegen.lol) is a Steam manifest generation and delivery platform. You can search games, download manifests, automate via API, and use the Discord bot.

## What you need first

1. A **Discord account**
2. Membership in the **official OpenSteam Discord server**
3. **Verification** completed (required before dashboard/API access)
4. An upgraded plan if you need API keys or higher limits (Free tier is limited)

## Quick start (web)

1. Go to **http://127.0.0.1:3000**
2. Click **Sign in with Discord**
3. Join the OpenSteam Discord server if you have not already
4. In Discord, open the verify channel and click **Verify**
5. Complete OAuth and security checks on the verification page
6. Return to the site — you can now search by Steam App ID or game name and generate manifests

## Quick start (Discord)

After you are verified:

- `/gen appid:730` — generate a manifest for Counter-Strike 2
- `/request appid:123456` — request a game that is not in the database yet
- `/status` — check your plan and daily usage

## Where things live

| Task | Location |
|------|----------|
| Web generation | gamegen.lol home page |
| API keys | Dashboard → API Keys |
| Usage & limits | Dashboard or `/status` in Discord |
| Upgrade plan | /pricing or Pandabase checkout |
| Developer docs | /docs and API_DOCUMENTATION.md |
| Help / issues | Support ticket in Discord |

## Important rules

- Login is **Discord OAuth only** — no separate email/password
- Leaving the Discord server may require **re-verification**
- **VPN/proxy** is blocked during verification
- Do not share API keys in public channels

## Next steps

- Read **Discord Verification** if verify fails or you see a block message
- Read **Plans and Limits** before heavy API use
- Read **API Troubleshooting** if you get 401/403/429 errors
