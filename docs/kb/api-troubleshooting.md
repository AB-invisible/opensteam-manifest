# API Troubleshooting

OpenSteam provides a new **v2 API** utilizing Header-Based Authentication, alongside a legacy v1 API.

**v2 API Format:** `http://127.0.0.1:3000/api/v2/{endpoint}/{appId}` (Pass key via `Authorization: Bearer YOUR_KEY` header)
**v1 API Format (DEPRECATED):** `http://127.0.0.1:3000/api/{YOUR_KEY}/{endpoint}/{appId}`

> [!WARNING]
> The v1 API is officially deprecated. API Keys created from July 5th, 2026 onwards will receive an `HTTP 666` error if they attempt to use the legacy endpoints. Please migrate to the v2 API immediately.

Full reference: **API_DOCUMENTATION.md** and **/docs** on the website.

## Before you debug

1. Confirm you are **verified** on OpenSteam
2. Confirm your plan includes API access (Free has limited API)
3. Copy your key from **Dashboard → API Keys** — do not use a truncated or old key
4. Confirm the key is **enabled**

## Common errors

### 401 Unauthorized

**Causes**

- Invalid API key
- Key disabled by you or admin
- Wrong key format or missing header

**Fix**

- Regenerate key in dashboard if unsure
- Ensure you are using the v2 API structure: `/api/v2/generate/730`
- Confirm your key is passed in the headers: `Authorization: Bearer YOUR_KEY` or `X-API-Key: YOUR_KEY`

### 403 Forbidden

**Causes**

- Account banned or suspended
- Activation endpoint: machine or key disabled
- Verification revoked (left Discord / not verified)

**Fix**

- Check dashboard access — if locked, re-verify or open support ticket
- For Windows app activation: check activation status is `ACTIVE`

### 429 Too Many Requests

**Causes**

- Daily API quota exhausted
- Hourly or per-minute burst limit hit
- Temporary Sentinel jail (short cooldown)

**Fix**

- `GET /api/v2/usage` or `/api/v2/stats` for remaining quota
- Wait for reset (`X-RateLimit-Reset` header)
- Upgrade plan for higher limits
- Slow down automated scripts — respect RPM limits

### 666 Legacy API Blocked

**Causes**

- Attempting to use a deprecated `v1` endpoint (`/api/{key}/...`) with an API key generated on or after July 5th, 2026.

**Fix**

- Migrate your application to use the `v2` endpoints (`/api/v2/...`). See the `/docs` page for details.

### Game not found / request rejected

**Causes**

- App ID not in database yet
- DLC or non-game App ID submitted to `/request`
- Invalid Steam App ID

**Fix**

- `POST /api/v2/request/{appId}` for base games only
- Or `/request` in Discord
- Verify App ID on Steam store URL

## Useful endpoints (v2)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v2/generate/{appId}` | Generate / fetch manifest |
| `GET /api/v2/download/{appId}` | Direct ZIP download |
| `POST /api/v2/request/{appId}` | Request new game ingestion |
| `GET /api/v2/usage` | Detailed usage breakdown |
| `GET /api/v2/stats` | Lightweight quota check |
| `POST /api/v2/bulk/generate` | Bulk generate (Reseller+) |
| `POST /api/v2/onlinefix/sync` | Reseller OnlineFix sync |
| `POST /api/v2/activate` | Windows app activation |
| `GET /api/openapi` | OpenAPI machine spec |

## Response headers

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Hourly limit |
| `X-RateLimit-Remaining` | Remaining this hour |
| `X-RateLimit-Reset` | Unix timestamp when hour resets |
| `X-RateLimit-Error` | Block reason if present |

## Security best practices

- Never post full API keys in Discord or public repos
- Rotate keys if exposed
- Use environment variables in production apps
- Back off on 429 — do not hammer the API

## Still stuck?

Open a support ticket with:

- Your Discord username (not your API key)
- Endpoint you called
- HTTP status code
- Error message body (redact key)
