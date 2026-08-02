# 🚀 v2 Update Changelog - Massive Feature Drop!

We are incredibly excited to announce our **v2 update**, bringing a massive wave of new features, a completely modernized **v2 API**, deep Telegram integration, enhanced Admin tools, and huge architectural improvements. Here is every single change introduced today:

## 🔌 v2 API Architecture (Header-Based Auth)
We have officially recreated all legacy API endpoints under our new **v2 API** structure, now utilizing robust **header-based authentication**. The full suite of new v2 endpoints includes:
* `POST /api/v2/activate`
* `POST /api/v2/bulk/generate`
* `GET /api/v2/download/[appId]`
* `POST /api/v2/generate/[appId]`
* `POST /api/v2/request/[appId]`
* `GET /api/v2/stats`
* `GET /api/v2/usage`
* `GET /api/v2/user/stats`
* **Reseller Endpoints:** Added a brand new `POST /api/v2/onlinefix/sync` endpoint dedicated to Reseller OnlineFix sync operations.
* **Docs:** Updated all API documentation to align with the new v2 standard.

## 🤖 Telegram Bot Integration (v2)
* **AI Support Bot:** Fully integrated an intelligent AI Support Bot directly into Telegram, capable of instantly answering queries based on our Knowledge Base.
* **New Telegram Commands:** Added powerful commands directly in Telegram, including `/latest` and `/top`, complete with rich interactive inline button menus.
* **Discord Linking & Quotas:** Enforced Discord account linking for Telegram users. Introduced daily quotas specifically for Telegram bot generations to ensure fair usage and prevent abuse.
* **Telegram Promos Admin UI:** Added a brand new admin interface and backend routing to schedule, monitor, and manage Telegram promotions seamlessly from the dashboard.
* **Automated Promo Cron:** Implemented a new cron endpoint for automated Telegram promos, now featuring "Crack Worlds" information directly in the broadcasts.
* **Footer Links:** Added an official Telegram community link to the main site footer.

## 🛡️ Admin Dashboard & Verification
* **Alt Verification Review:** Implemented a strict alt-account policy with a new dashboard interface that allows staff to manually approve or reject blocked alt-account verifications.
* **Generations Tracking:** Added a new **Generations Panel** in the Admin Dashboard to log, monitor, and manage AI generations originating from Telegram.
* **Staff Management Tabs:** Completely reworked the admin sidebar and navigation, introducing dedicated Staff Management tabs for better workflow.
* **Verification Tab Overhaul:** Extracted the verification UI from general settings into its own dedicated, high-performance tab.
* **Role Permissions:** Explicitly granted the `OWNER` role full access to manage both the Verification queue and Telegram Promos via the admin panel.

## ⚙️ Fallbacks, AI & System Architecture
* **Ryuu-first Autogen:** Implemented a sophisticated Ryuu-first autogen fallback system. Ryuu is now prioritized over Hubcap/Morrenus and DepotBox, featuring a paced fallback mechanism to handle high loads flawlessly.
* **Claude 3.5 & 3.8 Opus Integration:** Upgraded our LLM router to natively include the brand new **Claude 3.5** and **Claude 3.8 Opus** models for our AI services.
* **Live Discord Redirects:** Added a `/discord` redirect route (`gamegen.lol/discord`) that automatically syncs and routes users to live, active Discord community invites.
* **Bot Daemon Enhancements:** Overhauled the background bot daemon and added a new script specifically to sync community invites in real-time.

## 📚 Expanded Knowledge Base & Docs
* **Comprehensive KB Launch:** Created a completely new Docs/Knowledge Base system containing detailed documentation on:
  * API Troubleshooting
  * Dashboard & API Keys
  * Discord Bot Commands
  * Forge Marketplace
  * Sentinel & Security Protocols
  * Plans & Limits
  * Hosted Bots
  * Support & Escalation
  * Discord Verification Guidelines
* **TOS & Privacy Updates:** Updated the Privacy Policy and Terms of Service to cover the newly introduced Telegram Bot integrations and data handling policies.

## 🧪 Testing & Reliability
* **Extensive Unit Tests:** Added robust new test suites to ensure system stability for:
  * Discord DM Routing
  * Guild Join Welcome Flows
  * Verification Alt Policies
