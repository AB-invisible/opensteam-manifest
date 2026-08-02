/**
 * Statuspage utility to update component status on Atlassian Statuspage.
 * Throttles pings to ensure we don't spam the API.
 */

const STATUSPAGE_COMPONENTS = {
  api: 'f0fjfzrkh9j2',
  database: 'ybwzbtww2bqn'
}

const BETTER_UPTIME_HEARTBEATS = {
  api: 'https://uptime.betterstack.com/api/v1/heartbeat/mjcwR9yTen7bCEfwjkHjPXAX',
  database: 'https://uptime.betterstack.com/api/v1/heartbeat/WhWrV1nQ1id5jNDrAtRsgBnG'
}

type ComponentType = keyof typeof STATUSPAGE_COMPONENTS

const lastPing: Record<string, number> = {}
const PING_INTERVAL = 30 * 1000 // Update at most once per 30 seconds per component

export async function pingHeartbeat(type: ComponentType) {
  const componentId = STATUSPAGE_COMPONENTS[type]
  const betterUptimeUrl = BETTER_UPTIME_HEARTBEATS[type]
  
  if (!componentId && !betterUptimeUrl) return

  const now = Date.now()
  if (lastPing[type] && now - lastPing[type] < PING_INTERVAL) {
    return
  }

  lastPing[type] = now

  // 1. Better Uptime Heartbeat
  if (betterUptimeUrl) {
    try {
      fetch(betterUptimeUrl).catch(err => {
        console.error(`[Heartbeat] Failed to ping Better Uptime for ${type}:`, err.message)
      })
    } catch (error) {
      // Ignore
    }
  }

  // 2. Statuspage API Update
  const pageId = process.env.STATUSPAGE_PAGE_ID
  const apiKey = process.env.STATUSPAGE_API_KEY

  if (pageId && apiKey && componentId) {
    try {
      const url = `https://api.statuspage.io/v1/pages/${pageId}/components/${componentId}`
      
      // Fire and forget
      fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `OAuth ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          component: { status: 'operational' }
        })
      }).then(res => {
        if (!res.ok) {
          res.text().then(text => console.error(`[Statuspage] Failed to update ${type}:`, text))
        }
      }).catch(err => {
        console.error(`[Statuspage] Failed to update ${type}:`, err.message)
      })
    } catch (error) {
      // Ignore
    }
  }
}

let intervalStarted = false;

/**
 * Starts a background interval to ensure the "operational" status is maintained.
 */
export function startHeartbeatInterval() {
  if (intervalStarted || process.env.NODE_ENV !== 'production') return;
  intervalStarted = true;

  // Initial pings
  pingHeartbeat('api');
  pingHeartbeat('database');

  // Ping every 45 seconds (Safe margin for most settings)
  setInterval(() => {
    pingHeartbeat('api');
    pingHeartbeat('database');
  }, 45 * 1000);

  console.log('[Statuspage] Background component monitoring started.');
}


