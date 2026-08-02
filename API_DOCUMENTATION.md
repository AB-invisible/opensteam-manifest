# API Documentation - OpenSteam Platform

Welcome to the OpenSteam Developer API. Our platform utilizes a **Path-Based API Key** system for maximum ease of use, eliminating the need for complex headers in most scenarios.

## 🔑 Authentication

Include your API key directly in the URL path. All endpoints below follow this standard format.

**Standard URL Format:**
`http://127.0.0.1:3000/api/{YOUR_API_KEY}/{ENDPOINT}/{appId?}`

For tools that prefer traditional headers, we also support:
- `Authorization: Bearer {YOUR_API_KEY}`
- `X-API-Key: {YOUR_API_KEY}`

All methods are interchangeable. Path-based is recommended for simple `curl` or browser testing, while Headers are recommended for production applications.

---

## 🛠️ Endpoints

### 1. Fast Generate
**GET** `/api/{apiKey}/generate/{appId}`

The primary engine of the platform. Retrieves manifest metadata and provides a secure, short-lived download payload.

- **Query Parameters**:
  - `format`: (Optional) Use `?format=zip` to download the zip file directly instead of receiving JSON meta-data.
    
- **Response** (200 OK):
```json
{
  "success": true,
  "generated": true,
  "manifest": {
    "id": "cm...abc",
    "appId": "730",
    "name": "Counter-Strike 2",
    "downloadUrl": "http://127.0.0.1:3000/api/YOUR_API_KEY/download/730",
    "updatedAt": "2026-03-20T16:00:00.000Z"
  },
  "rateLimit": {
    "remaining": 1499,
    "limit": 1500,
    "resetAt": 1742489040
  }
}
```

### 2. Formal Game Request
**POST** `/api/{apiKey}/request/{appId}`

Programmatically request that a game be added to our database or re-scanned.

- **Body (optional)**: `{ "reason": "Missing manifest" }`
- **Example (curl)**: `curl -X POST "http://127.0.0.1:3000/api/YOUR_KEY/request/730"`
- **Accepted App Types**: Base Steam games only (`type=game`)
- **Rejected**: DLC AppIDs, non-game AppIDs, and nonexistent AppIDs
- **Response**: 
  ```json
  { "status": "sent", "appId": "730", "gameName": "..." }
  ```
- **Validation Errors**:
  ```json
  { "error": "Numeric App ID required." }
  { "error": "Steam AppID not found." }
  { "error": "DLC AppIDs are not allowed for game requests." }
  { "error": "Only base Steam games are allowed." }
  ```

### 3. Detailed Usage Report
**GET** `/api/{apiKey}/usage`

Retrieves a complete breakdown of your key's activity, including historical totals and daily quotas.

- **Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "totalRequests": 1050,
    "todayUsage": 12,
    "dailyLimit": 1500,
    "remaining": 1488,
    "endpointBreakdown": {
      "/api/keys/generate/730": 800,
      "/api/keys/stats": 250
    }
  }
}
```

### 4. Simple Stats
**GET** `/api/{apiKey}/stats`

A lightweight status check for plan status and remaining daily quota.



## 🛡️ Response Headers

Every API response includes standard headers to help you track your quota and stay compliant with our Smart Firewall.

| Header | Description |
| :--- | :--- |
| `X-RateLimit-Limit` | Your currently assigned hourly limit. |
| `X-RateLimit-Remaining` | Remaining requests available in the current hour. |
| `X-RateLimit-Reset` | Epoch timestamp (seconds) when the limit resets. |
| `X-RateLimit-Error` | (Optional) Detailed reason if you are currently blocked. |

---

## 🛡️ Smart Firewall & Plan Limits

Our security engine monitors and rate-limits ensuring 99.9% uptime for all developers. All limits are **persistent** across server restarts.

| Plan | Daily API Limit | Hourly Limit | Minute Limit (RPM) | Ryuu / Morrenus (default) |
| :--- | :--- | :--- | :--- | :--- |
| **Free** | 50 req/day | 15 req/hr | 10 RPM | ✅ On |
| **Regular** | 1,000 req/day | 500 req/hr | 60 RPM (1 req/s) | ❌ Off (admin can enable) |
| **Premium** | 5,000 req/day | 2,500 req/hr | 120 RPM (2 req/s) | ❌ Off (admin can enable) |
| **Reseller** | 30,000 req/day | 10,000 req/hr | 1,800 RPM (30 req/s) | ❌ Off (admin can enable) |
| **Business** | 100,000 req/day | 30,000 req/hr | 3,000 RPM (50 req/s) | ❌ Off (admin can enable) |
| **Custom** | 1,000,000+ req/day | 100,000+ req/hr | 6,000+ RPM (100+ req/s) | ❌ Off (admin can enable) |

- **Upstream auto-generation**: **Free** includes Ryuu and Morrenus by default for games not yet in cache. **Paid tiers** have them off unless staff enable them (plan overrides).
- **Sentinel Security**: Automated protection against scraper patterns, malicious payloads, or abuse. Performance-heavy users can contact us for **Security Bypass** status to avoid automated jails.
- **Temporary Jails**: Exceeding minute limits or triggering risk scores may result in a brief **30-second cooling period** rather than a permanent ban.

### 4. Bulk Generate (Reseller+)
**POST** `/api/{apiKey}/bulk/generate`

Generate up to 25 manifests in a single request. Requires Reseller plan or higher.

- **Body**: `{ "appIds": ["730", "570"] }`
- **Response**: `{ "success": true, "results": [{ "appId": "730", "status": "ok", "downloadUrl": "..." }] }`

### OpenAPI

Machine-readable spec: **GET** `/api/openapi`

## 💬 Support
Need a custom quote or higher limits? 
Join our [Discord Community](https://discord.gg/yKyKhSNGKz) for priority developer support.