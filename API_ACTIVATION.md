# Windows App Activation API

This endpoint allows the Windows desktop application to register an activation using an API key. This helps in tracking installations and machine-specific usage.

## Endpoint

`POST /api/[apiKey]/activate`

### Parameters

- `apiKey` (path): Your valid OpenSteam API key.

### Request Body (JSON)

| Field | Type | Description |
| :--- | :--- | :--- |
| `machineId` | `string` | Unique identifier for the user's machine (HWID). |
| `os` | `string` | Operating system version (e.g., "Windows 11 23H2"). |
| `version` | `string` | Version of the Windows application being activated. |

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Windows app activated successfully.",
  "data": {
    "activationId": "...",
    "activatedAt": "2024-05-09T12:00:00.000Z",
    "isNewUser": true,
    "status": "ACTIVE",
    "enabled": true,
    "user": {
      "username": "...",
      "plan": "PREMIUM",
      "role": "ADMIN",
      "isStaff": true
    }
  },
  "usage": {
    "today": 5,
    "limit": 1000,
    "remaining": 995,
    "resetAt": 1715299200
  }
}
```

### Error Responses

- `401 Unauthorized`: Invalid or missing API key.
- `403 Forbidden`: Activation denied (API key or machine disabled).
- `429 Too Many Requests`: Rate limit or daily quota exceeded.
- `500 Internal Server Error`: Server-side processing failure.

### Activation Status

Activations can be managed at two levels:

1. **API Key Level**: If an administrator disables activations for your API key, all activation requests will return a `403 Forbidden` error.
2. **Machine Level**: Specific machine activations can be disabled or revoked. If your `machineId` is blocked, you will receive a `403 Forbidden` error with the activation status.

Possible statuses:
- `ACTIVE`: The activation is valid and in use.
- `DISABLED`: The activation has been temporarily disabled.
- `REVOKED`: The activation has been permanently revoked.

---

## Implementation Details

- **Upsert Logic**: Providing the same `machineId` with the same API key will update the existing activation record (OS, version, IP) instead of creating a new one.
- **Quota Consumption**: Each activation request counts as one (1) usage toward your daily API quota.
- **Rate Limiting**: Standard API burst and hourly limits apply to this endpoint.
- **Persistence**: Activations are stored permanently in the database and linked to your account.
