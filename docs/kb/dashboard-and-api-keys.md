# Dashboard and API Keys

The OpenSteam dashboard is your control panel after Discord sign-in and verification.

## Accessing the dashboard

1. Sign in at **http://127.0.0.1:3000** with Discord
2. Complete **verification** if prompted
3. Open **Dashboard** from the navigation

If you see a **re-verify banner**, return to Discord and complete verification again.

## Dashboard sections (common)

| Area | Purpose |
|------|---------|
| **API Keys** | Create, name, enable/disable, regenerate keys |
| **Usage / generations** | Today's web gens and history |
| **Branded Bot** | Regular/Premium hosted bot setup |
| **Custom Bot** | Reseller/Business own-app bot setup |
| **Forge** | Upload and manage user scripts |
| **Support tickets** | View your ticket history |
| **Organizations** | Team/org features (if applicable) |

Exact tabs depend on your plan and role.

## API keys

### Who gets keys

- **Free** — very limited API (50/day); keys may be restricted by policy
- **Paid plans** — full API access per plan limits

### Creating a key

1. Dashboard → **API Keys**
2. Create key with a descriptive name
3. Copy the key **once** — store it securely
4. Use the key in your request headers (`Authorization: Bearer YOUR_KEY`) and connect to the v2 endpoints: `http://127.0.0.1:3000/api/v2/generate/{appId}`
   *(Note: The old `/api/{KEY}/...` path-based routes are deprecated and blocked for keys generated after July 5th, 2026).*

### Key hygiene

- One key per app/environment is recommended
- Disable keys you no longer use
- Regenerate if leaked — old key stops working
- Never commit keys to GitHub or paste in Discord

### Multiple keys

Daily API quota is typically shared across keys for the same user account (velocity pool). Check usage endpoint for your account state.

## Web generation tracking

The home page and dashboard show:

- Generations used today
- Daily limit for your plan
- Recent generation history

## Plan display

Your plan badge (Free, Regular, Premium, etc.) appears in session/dashboard. After Pandabase purchase, refresh session or sign out/in if stale.

## Windows app activation

Desktop app uses `POST /api/v2/activate` (with Bearer token auth) and a machine ID in the JSON body. Each activation counts toward API quota. See **API_ACTIVATION.md**.

## Staff roles

Moderators and admins see additional tools — not available to normal users. Do not ask Atis for admin dashboard access.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard empty / 401 | Re-verify; clear cookies; sign in again |
| No API Keys tab | Upgrade plan or check verification |
| Key works in browser but not app | Check enabled flag; ensure you are using v2 endpoint with header auth |
| Usage seems wrong | Compare `/api/v2/usage` with dashboard |
