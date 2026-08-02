# API v2 Migration Guide

The OpenSteam platform is transitioning to a more secure, header-based API architecture (v2). This guide outlines the changes and provides steps for migrating your applications.

## Why Migrate to v2?

The v1 API utilized path-based authentication (`/api/{KEY}/...`). This approach had several drawbacks:
- API Keys were logged in web server access logs.
- URLs could be easily copied and shared.
- It was inflexible for complex routing setups.

The **v2 API** resolves this by enforcing standard `Authorization: Bearer` headers. It is more secure, cleaner to use, and standardized.

## Cutoff Date & HTTP 666 Error

> [!WARNING]
> **Important:** The v1 legacy API is deprecated. Any API Key generated on or after **July 5th, 2026** is blocked from using the v1 legacy paths. 
> 
> Attempting to use a new key with an old v1 endpoint will result in an immediate `HTTP 666` error with the message: *"Please use our new v2 endpoint from http://127.0.0.1:3000/docs"*. 

Keys generated prior to this date will continue to function on the legacy endpoints to avoid breaking existing integrations, but you are strongly encouraged to migrate immediately.

## Converting Requests to v2

### Example: Generating a Manifest

**v1 Legacy Request:**
```bash
curl "http://127.0.0.1:3000/api/gg_1234567890abcdef/generate/730"
```

**v2 Standard Request:**
```bash
curl -X GET "http://127.0.0.1:3000/api/v2/generate/730" \
     -H "Authorization: Bearer gg_1234567890abcdef"
```

*Alternatively, you can use the `X-API-Key` header instead of `Authorization`.*

## New Endpoints Overview

All endpoints have been mapped from `/api/{KEY}/*` to `/api/v2/*`.

| Feature | v2 Endpoint | Method | Notes |
|---------|-------------|--------|-------|
| **Manifest Generation** | `/api/v2/generate/{appId}` | `GET` | Core manifest fetch |
| **ZIP Download** | `/api/v2/download/{appId}` | `GET` | Direct ZIP download |
| **Game Requests** | `/api/v2/request/{appId}` | `POST` | Ingestion request |
| **Quota Usage** | `/api/v2/usage` | `GET` | Usage tracking |
| **Simple Stats** | `/api/v2/stats` | `GET` | Lightweight stats |
| **App Activation** | `/api/v2/activate` | `POST` | Windows app activation |
| **Reseller Sync** | `/api/v2/onlinefix/sync` | `POST` | Sync OnlineFix catalogs |

## The Reseller Sync Endpoint

We have introduced a brand new endpoint exclusively for Resellers: `POST /api/v2/onlinefix/sync`.
This endpoint triggers an asynchronous synchronization process that updates our local catalog with the latest releases from the upstream OnlineFix provider. This ensures your downstream integrations have access to the freshest cracks.
