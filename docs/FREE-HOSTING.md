# Run OpenSteam 24/7 without your PC

Your current setup needs **4 PM2 processes on Windows** (web, bot, HTTPS proxy, Cloudflare quick tunnel). That only works while the PC is on.

Move to this **$0/month** stack:

| Piece | Free service | Why |
|-------|--------------|-----|
| Database | [Neon](https://neon.tech) | Managed Postgres, no local DB |
| Web + Bot | [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) | 24/7 ARM VM (4 CPU / 24 GB RAM) |
| Public URL | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | `opensteam.lol` → VM, no open ports |

After migration you can **stop PM2 on your PC** and shut it down.

---

## Step 1 — Neon Postgres (5 min)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the connection string (must include `?sslmode=require`).
3. Put it in `.env` as `DATABASE_URL`.

**Migrate your local data (optional but recommended):**

On your PC (with Postgres running locally):

```powershell
# Export (adjust password/db name)
$env:PGPASSWORD='your-local-password'
pg_dump -h 127.0.0.1 -U postgres -d manifest-generator -Fc -f opensteam.dump
```

Upload `opensteam.dump` to the VM, then on the VM with Neon URL:

```bash
pg_restore -d "$DATABASE_URL" --no-owner --no-acl opensteam.dump
```

If you skip migration, a fresh deploy runs `prisma migrate deploy` on empty Neon.

---

## Step 2 — Cloudflare Tunnel (10 min)

Stop using the **quick tunnel** on your PC (`trycloudflare.com` URLs that change).

1. Cloudflare Dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create**.
2. Name it `opensteam`, install connector → copy the **token**.
3. Add a **Public Hostname**:
   - Hostname: `opensteam.lol` (and `www` if you use it)
   - Service: `http://127.0.0.1:3000` (cloudflared shares the web container network in Docker)
4. Save `TUNNEL_TOKEN=...` in `.env`.

DNS for `opensteam.lol` must already be on Cloudflare (orange cloud).

---

## Step 3 — Oracle Cloud VM (20 min)

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) (credit card for verification, no charge on Always Free).
2. Create an **Ampere A1** instance:
   - Ubuntu 22.04 or 24.04
   - Shape: VM.Standard.A1.Flex — **2 OCPU, 12 GB RAM** (enough for web + bot)
   - Boot volume: 50–100 GB
3. Open **only SSH (22)** in the security list (Cloudflare Tunnel handles HTTPS).
4. SSH in and run:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/scripts/cloud-install.sh | bash
# log out/in so docker group applies
```

Or manually install Docker: `curl -fsSL https://get.docker.com | sh`

---

## Step 4 — Deploy on the VM

Copy the project to the VM (`git clone`, `scp`, or zip).

```bash
cd opensteam   # repo root (gamegen-manifests-full)
cp .env.cloud.example .env
nano .env      # paste Neon URL, Discord tokens, TUNNEL_TOKEN, keys from your PC .env
```

Build and start:

```bash
docker compose -f docker-compose.cloud.yml up -d --build
docker compose -f docker-compose.cloud.yml logs -f
```

You should see:

- `web` — Next.js on port 3000 (internal)
- `bot` — Discord bot connected
- `cloudflared` — tunnel active

Check bot:

```bash
docker compose -f docker-compose.cloud.yml logs -f bot
```

---

## Step 5 — Turn off your PC stack

On Windows, after the cloud bot is online:

```powershell
pm2 stop manifest-bot manifest-web manifest-https manifest-tunnel
pm2 save
```

Discord allows **one** bot session per token — do not run local + cloud at the same time.

Update Discord Developer Portal → OAuth redirect URLs if needed:

- `https://opensteam.lol/api/auth/callback/discord`

---

## Environment checklist

Copy these from your current PC `.env` into cloud `.env`:

- `DATABASE_URL` → Neon connection string
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`
- `ADMIN_API_KEY`, `STEAM_API_KEY`, `RYUU_API_KEY`, `MORRENUS_API_KEY`
- `TUNNEL_TOKEN`
- Any webhooks / Resend / Pandabase keys you use

**Do not set** `INTERNAL_APP_URL` to the public URL on cloud — compose sets `http://web:3000` for bot→web uploads (fixes TLS errors).

---

## Useful commands

```bash
# Restart after .env change
docker compose -f docker-compose.cloud.yml up -d --build

# Bot logs only
docker compose -f docker-compose.cloud.yml logs -f bot

# Stop everything
docker compose -f docker-compose.cloud.yml down

# Register Discord slash commands (once, from VM)
docker compose -f docker-compose.cloud.yml exec bot node scripts/register-commands.js
```

---

## Alternatives (also free / cheap)

| Host | Bot 24/7? | Notes |
|------|-----------|-------|
| **Oracle Always Free** | Yes | Best free option; setup takes ~30 min |
| **Fly.io** | Limited free credits | Good if you already use Fly |
| **Hetzner CX22** | ~€4/mo | Not free but simplest paid option |

Discord bots **cannot** run on Vercel/Netlify (no persistent WebSocket). You need a small always-on VM or container host for the bot; Neon + Cloudflare handle the rest for free.

---

## Troubleshooting

**Bot offline but web works**

```bash
docker compose -f docker-compose.cloud.yml logs bot
```

Check `DISCORD_BOT_TOKEN` in `.env` and that local PM2 bot is stopped.

**Autogen / upload TLS errors**

Ensure `INTERNAL_APP_URL=http://web:3000` in the bot service (already set in `docker-compose.cloud.yml`).

**Tunnel not routing**

Verify `TUNNEL_TOKEN` and Cloudflare hostname points to `http://localhost:3000` on the VM where cloudflared runs.
