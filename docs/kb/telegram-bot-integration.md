# Telegram Bot Integration

The new OpenSteam Telegram Support AI Bot is an extension of our platform designed to provide quick game generations, top games lists, and automated updates directly within Telegram.

## Getting Started & Linking Accounts

To use the Telegram Bot, you must first link your Telegram account to your verified OpenSteam / Discord account.

1. **Verify Your Discord Account:** Ensure you are fully verified on the OpenSteam Discord server and have access to the dashboard.
2. **Obtain Linking Code:** Use the `/telegram` command on Discord or visit your dashboard to obtain your unique 6-digit Telegram linking code.
3. **Link on Telegram:** Start a conversation with our official Telegram bot (`@OpenSteamAI_Bot`) and send your linking code or use `/link {code}`.
4. **Success:** The bot will confirm that your account is successfully linked. You will now share your API generation limits with the Telegram bot.

## Available Telegram Commands

The bot supports rich interactive commands via Telegram's inline keyboards and menus.

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and account status overview |
| `/latest` | Displays the most recently added games with inline buttons for direct Generation |
| `/top` | Displays the most generated games today, categorized by popularity |
| `/gen {appId}` | Quickly requests a manifest generation for a specific game (consumes API quota) |
| `/help` | General guide and links to support |
| `/link {code}` | Link your Telegram profile with your OpenSteam account |
| `/unlink` | Disconnects your Telegram account from your OpenSteam profile |

## Telegram Promos & Notifications

The Telegram bot acts as an active broadcast channel for the community:
- **Crack Worlds Feed:** The bot is integrated with a cron job that automatically scrapes Crack Worlds every 3 minutes. New cracks or repacks are automatically announced in the connected Telegram channels.
- **Automated Promos:** The Admin team frequently runs automated promotions via the Telegram bot, offering limited-time generation boosts or discounted subscription tiers.

## Daily Quotas

Generations requested via the Telegram Bot count towards your standard OpenSteam Daily Quota.
- If you use `/gen 730` on Telegram, 1 generation is deducted from your daily limit.
- You can check your remaining Telegram quota via `/start` or on your web dashboard.
- Hitting the rate limit on Telegram applies exactly the same Sentinel rules and cooldowns as the web and Discord APIs.
