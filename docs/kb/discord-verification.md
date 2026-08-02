# Discord Verification

Verification is required before you can use the OpenSteam web dashboard, API keys, and most platform features.

## Why verification exists

- Confirms you are in the official OpenSteam Discord community
- Runs security checks (VPN/proxy, abuse signals)
- Links your Discord identity to your OpenSteam account

## Step-by-step

1. **Join** the official OpenSteam Discord server
2. Find the **verify channel** (verify embed posted by the bot)
3. Click the **Verify** button — you receive a personal verification link
4. Open the link and sign in with **Discord OAuth** if prompted
5. Wait for checks to complete on the verify page
6. On success you receive the **Verified** role in Discord and platform access is restored

## After verification

- You can use the website dashboard and create API keys (on eligible plans)
- `/gen` and other bot commands work according to your plan
- If you **leave the server**, access may be revoked until you **re-verify**

## Common block reasons

### VPN or proxy detected

**Message:** VPN or proxy detected. Disable it and try again.

**Fix:** Turn off VPN, proxy, or privacy relay. Use a normal residential connection and restart verification from Discord.

### Verification blacklist

**Message:** Verification is blocked because of restricted Discord connections.

You may be blocked if:

- You are **friends** with a blacklisted Discord user, or
- You are a member of a **blacklisted Discord server**

**Fix:** Unfriend the listed user or leave the listed server. Then start verification again from the **Verify** button in Discord. Staff cannot override this until the connection is removed.

### Missing or expired session

**Message:** Missing session / oauth_required / invalid session

**Fix:** Go back to Discord and click **Verify** again to get a fresh link. Do not reuse old bookmarked verify URLs.

### Alt / risk flags

Verification may flag alt-account signals. In some cases verification still completes but staff are notified. Serious cases may need human review.

## Re-verification

You need to re-verify when:

- You left and rejoined the Discord server
- Your account shows a re-verify banner on the website
- Staff reset your verification status

## What Atis cannot do

- Manually verify your account
- Remove verification blacklist entries (staff admin action)
- Bypass VPN detection

Open a **support ticket** only if you believe verification failed due to a platform bug after following all steps above.
