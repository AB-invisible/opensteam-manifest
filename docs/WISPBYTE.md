# Host OpenSteam bot on Wispbyte (free 24/7)

Wispbyte is a good fit for the **Discord bot only**. The full Next.js website is too heavy for the free tier (512 MB RAM, 1 GB disk).

## Recommended split

| Part | Where | Cost |
|------|--------|------|
| Discord bot | **Wispbyte** | Free (login every 2 weeks) |
| Database | **Neon** (already set up) | Free |
| Website | Fly.io / Vercel / your PC + tunnel | Pick one |

Your Neon project **`opensteam-manifest`** already has schema + bot config copied from local.

---

## 1. Build the upload zip (on your PC)

```powershell
cd C:\Users\ayoub\Downloads\gamegen-manifests-full
node scripts/build-wispbyte-bundle.js
node scripts/generate-wispbyte-env.js
```

Outputs:

- `dist/wispbyte-opensteam-bot.zip` — upload to Wispbyte
- `dist/wispbyte-env.txt` — paste into environment variables

Or double-click **`deploy-wispbyte.cmd`**.

---

## 2. Create Wispbyte server

1. Sign up: [wispbyte.com/client](https://wispbyte.com/client) (no card)
2. **Create Server** → **Free plan**
3. Docker image: **Node.js 20** or **22** (log showed v19.9.0 — too old; bot needs Node 20+)
4. Upload **everything** from the zip via the file manager

---

## 3. Startup settings

Wispbyte’s default Node egg runs `node ${JS_FILE}` after `npm install` — **not** `npm start` unless you change it.

**Option A (easiest):** set **JS_FILE** to `index.js` (included in the zip).

**Option B:** override **Startup command** to:

```bash
npm start
```

| Setting | Value |
|---------|--------|
| **JS_FILE** | `index.js` (if using default egg) |
| **Startup command** | `npm start` (if you override the egg) |
| **Node version** | 20 or 22 |

Copy every line from `dist/wispbyte-env.txt` into **Startup → Environment variables**.

**First boot:** `npm install` takes **2–4 minutes**. Do not restart until it finishes and you see bot logs (not just npm progress bars).

Important:

- `DATABASE_URL` = your **Neon** connection string (not local Postgres)
- `MANIFEST_UPLOAD_BASE_URL` = `https://opensteam.lol` (or wherever the web app lives)
- Do **not** run the bot on your PC and Wispbyte at the same time (same Discord token)

---

## 4. Stop local bot

```powershell
pm2 stop manifest-bot
pm2 save
```

You can also stop `manifest-tunnel` / `manifest-https` if the site moves to cloud later. The bot does not need your PC once Wispbyte is online.

---

## 5. Register slash commands (once)

In Wispbyte **Console**, after first successful start:

```bash
node scripts/register-commands.js
```

---

## Free tier limits

- **512 MB RAM** — enough for OpenSteam bot if voice/ffmpeg features are rarely used
- **1 GB disk** — `npm install` must fit; we ship a trimmed `package.json` (no Next.js/React)
- **Activity** — log in at [wispbyte.com/client](https://wispbyte.com/client) at least every **2 weeks**

Need more RAM? Premium from ~€3.99/year on Wispbyte.

---

## Troubleshooting

**Stuck on npm install / only progress bars**

- First install is slow on free tier. Wait 3–4 minutes.
- If it never finishes, check disk (need ~500 MB free after install).

**`EBADENGINE` / Node v19**

- Switch server image to **Node 20** or **22** in Wispbyte settings, then restart.

**Bot never starts after install**

- Default startup is `node ${JS_FILE}` — set **JS_FILE** = `index.js`, or use startup command `npm start`.
- Confirm env vars are set (`DISCORD_BOT_TOKEN`, `DATABASE_URL`, etc.).

**Bot offline after deploy**

- Check Console logs for missing env vars
- Confirm `DATABASE_URL` reaches Neon (`?sslmode=require`)
- Ensure local `pm2 stop manifest-bot` ran

**Autogen upload errors**

- Set `MANIFEST_UPLOAD_BASE_URL` to a **live HTTPS** web URL (not `127.0.0.1`)
- Web must be running somewhere (Fly, Vercel, or temporarily your PC)

**Out of memory**

- Upgrade Wispbyte plan or disable heavygen / voice on free tier
