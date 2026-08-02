# Discord Bot Commands

The OpenSteam community bot runs in the official Discord server. Hosted bots (branded/custom) support a subset of commands in your own server.

## Manifest commands

| Command | Who | Description |
|---------|-----|-------------|
| `/gen appid:<id>` | Verified users | Generate a manifest for a Steam App ID |
| `/dlcgen appid:<id>` | Verified users | Generate DLC Lua for an App ID |
| `/request appid:<id>` | Verified users | Request a missing base game be added to the database |
| `/status` | Verified users | View account status and daily usage |

**App ID tips**

- Use the numeric **Steam App ID** (e.g. `730` for CS2)
- `/request` accepts **base games only** — not DLC or invalid IDs
- If `/gen` fails, try `/request` first

## Economy & shop (server fun)

| Command | Description |
|---------|-------------|
| `/coins` | Check your coin balance |
| `/daily` | Claim daily free coins (100–300) |
| `/weekly` | Claim weekly coin bonus |
| `/work` | Work a random job for coins (1 hour cooldown) |
| `/shop` | View the Sentinel Cosmetic Perk Shop |
| `/buy item:<name>` | Purchase a shop perk with coins |

Shop items are **cosmetic/fun perks** (e.g. color roles) — not plan upgrades.

## Staff / admin commands

These require moderator or administrator permissions on the platform or Discord:

- `/admin` — stats, user lookup, ban/unban, manifest check, IP lookup, etc.
- `/drop` — administrator-only account drops from platform pools
- `/autogen` — upstream game import jobs (staff operations)

Regular members should not expect access to admin commands.

## Hosted bot commands (your server)

Depends on plan:

| Plan | Hosted type | Typical commands |
|------|-------------|------------------|
| Regular / Premium | Branded bot | `gen`, `help`, `status`, `link` |
| Reseller / Business | Custom bot | `gen`, `help`, `status`, `link`, `drop` |

Link your bot from **Dashboard → Branded Bot** or **Custom Bot**, then run `/link` in your Discord server with the **same account** that owns the plan.

## Help command

`/help` — overview of available commands (on hosted bots and where enabled).

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Command not showing | Re-invite the bot; check hosted bot manager is online (custom bots) |
| "Not verified" | Complete Discord verification first |
| "No permission" | Command is staff-only or plan-locked |
| Gen fails | Check `/status` limits; try `/request` for missing games |
