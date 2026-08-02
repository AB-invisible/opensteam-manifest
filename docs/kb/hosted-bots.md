# Hosted Bots

OpenSteam offers Discord bots you can run in **your own server** — either a shared **branded** bot or your own **custom** bot app.

## Branded bot (Regular / Premium)

**Who:** Regular and Premium subscribers

**What you get**

- Shared OpenSteam-branded bot instance
- Commands: `gen`, `help`, `status`, `link`
- Linked to your OpenSteam account and plan limits

**Setup**

1. Upgrade to **Regular** or **Premium**
2. Open **Dashboard → Branded Bot**
3. Invite/link the bot to your server
4. Run `/link` in your server with the **same Discord account** that paid for the plan

**Common mistakes**

- Wrong Discord account runs `/link` (buyer must link, or whoever owns the plan)
- Free user expecting branded bot — upgrade first
- Reseller/Business user on branded tab — use **Custom Bot** instead

## Custom bot (Reseller / Business)

**Who:** Reseller and Business subscribers

**What you get**

- Your own Discord application (client ID, secret, bot token)
- Commands: `gen`, `help`, `status`, `link`, `drop`
- Credentials encrypted and stored securely

**Setup**

1. Create a Discord application at https://discord.com/developers
2. Open **Dashboard → Custom Bot**
3. Enter client ID, client secret, and bot token
4. Complete OAuth callback flow
5. Run `/link` in your server

**Requirements**

- `HOSTED_BOT_ENCRYPTION_KEY` must be set on the platform (operator-side)
- **Custom bot manager** daemon must be running — if offline, bot will not connect

**Error:** "Custom bot manager is offline"

The platform owner must start the hosted custom bot manager. Users cannot fix this from the dashboard alone.

## Plan limits on hosted gen

Hosted `/gen` uses your plan's web or API daily limits (same account). Check `/status` in the hosted server.

## Business expiry

Business plans with `planExpiry` or cancellation may lose hosted bot access when inactive.

## Platform owner

The platform owner always has branded-bot access for testing regardless of plan.

## Troubleshooting

| Issue | Check |
|-------|-------|
| `/link` fails | Same Discord account as dashboard; plan active |
| Bot offline (custom) | Custom bot manager running; token valid |
| Commands missing | Re-invite with correct scopes; plan allows command set |
| Gen rate limited | `/status` — daily quota |

## Support

Hosted bot credential issues and manager outages need staff. Open a ticket — do not paste bot tokens in public chat.
