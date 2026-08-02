import type { HealthCheckResult } from './platform-health'

export type HealthNodePayload = {
  id: string
  label: string
  ok: boolean
  status: 'ok' | 'degraded' | 'skipped'
  summary: string
  metrics: Record<string, string | number | boolean>
  resolutionSteps: string[]
}

export function buildHealthNodes(health: HealthCheckResult): HealthNodePayload[] {
  const { checks } = health
  const storagePath = checks.storage.path || process.env.STORAGE_PATH || '/data'

  return [
    buildDatabaseNode(checks.database),
    buildStorageNode(checks.storage, storagePath),
    buildCommunityBotNode(checks.communityBot),
    buildHostedBotsNode(checks.hostedBots),
    buildUpstreamNode('ryuu', 'Ryuu', checks.upstreamRyuu, 'RYUU_API_URL'),
    buildUpstreamNode('morrenus', 'Morrenus', checks.upstreamMorrenus, 'MORRENUS_API_URL'),
  ]
}

function buildDatabaseNode(db: HealthCheckResult['checks']['database']): HealthNodePayload {
  if (db.ok) {
    return {
      id: 'db',
      label: 'Database',
      ok: true,
      status: 'ok',
      summary: `PostgreSQL reachable (${db.latencyMs ?? '?'}ms)`,
      metrics: { latencyMs: db.latencyMs ?? 0 },
      resolutionSteps: ['Database is healthy. No action required.'],
    }
  }

  return {
    id: 'db',
    label: 'Database',
    ok: false,
    status: 'degraded',
    summary: db.error || 'Database unreachable',
    metrics: { error: db.error || 'unknown' },
    resolutionSteps: [
      'Open Railway → your Postgres service and confirm it is running (not paused or crashed).',
      'In the web service variables, verify DATABASE_URL points at that Postgres instance.',
      'Redeploy after fixing credentials; startup runs node scripts/wait-for-db.js before migrations.',
      'If migrations fail, check deploy logs for Prisma errors and run POST /api/admin/maintenance/run after DB is up.',
      `Last error: ${db.error || 'connection refused or timeout'}`,
    ],
  }
}

function buildStorageNode(
  storage: HealthCheckResult['checks']['storage'],
  storagePath: string,
): HealthNodePayload {
  if (storage.ok) {
    return {
      id: 'storage',
      label: 'Storage',
      ok: true,
      status: 'ok',
      summary: `Manifest volume writable at ${storage.path || storagePath}`,
      metrics: { path: storage.path || storagePath },
      resolutionSteps: ['Storage path is writable. No action required.'],
    }
  }

  return {
    id: 'storage',
    label: 'Storage',
    ok: false,
    status: 'degraded',
    summary: storage.error || `Cannot write to ${storagePath}/manifests`,
    metrics: { path: storage.path || storagePath, error: storage.error || 'unknown' },
    resolutionSteps: [
      `Attach a Railway volume (or persistent disk) and mount it at STORAGE_PATH (currently "${storagePath}").`,
      'Ensure the manifests subdirectory exists and the app user can write to it.',
      'After attaching the volume, redeploy so manifest ZIPs survive restarts.',
      'Confirm free space — admin overview shows disk usage against the 10 GB volume limit.',
      `Last error: ${storage.error || 'permission denied or path missing'}`,
    ],
  }
}

function buildCommunityBotNode(bot: HealthCheckResult['checks']['communityBot']): HealthNodePayload {
  if (!bot.enabled) {
    return {
      id: 'bot',
      label: 'Community Bot',
      ok: false,
      status: 'degraded',
      summary: 'Discord bot disabled in SystemConfig',
      metrics: { enabled: false },
      resolutionSteps: [
        'Admin → Settings → set DISCORD_BOT_ENABLED to true (or remove the key so default is enabled).',
        'Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_CLIENT_SECRET in SystemConfig or env.',
        'Use Settings → "Repost verify message" after the bot is online.',
        'Restart the bot: Admin → Settings → Bot Controller → Start, or redeploy (ensure-bot.js runs on start).',
        'Check deploy logs for [Bot] or scripts/ensure-bot.js errors.',
      ],
    }
  }

  return {
    id: 'bot',
    label: 'Community Bot',
    ok: true,
    status: 'ok',
    summary: 'Bot enabled in configuration',
    metrics: { enabled: true },
    resolutionSteps: [
      'Bot is enabled. If commands still fail, open Settings → Bot Controller and confirm status is Active.',
      'Check DISCORD_BOT_TOKEN has not expired and the bot has required guild permissions.',
    ],
  }
}

function buildHostedBotsNode(hosted: HealthCheckResult['checks']['hostedBots']): HealthNodePayload {
  if (hosted.ok) {
    return {
      id: 'hosted',
      label: 'Hosted Bots',
      ok: true,
      status: 'ok',
      summary: `${hosted.running} running · ${hosted.total} total instances`,
      metrics: {
        running: hosted.running,
        total: hosted.total,
        stale: hosted.stale,
      },
      resolutionSteps: ['All active hosted bots are reporting within 15 minutes. No action required.'],
    }
  }

  return {
    id: 'hosted',
    label: 'Hosted Bots',
    ok: false,
    status: 'degraded',
    summary: `${hosted.stale} stale of ${hosted.running} running (${hosted.total} total)`,
    metrics: {
      running: hosted.running,
      total: hosted.total,
      stale: hosted.stale,
    },
    resolutionSteps: [
      'Open Admin → Hosted Bots and review instances stuck in ACTIVE with no recent heartbeat.',
      'For each stale instance: use Restart on the Branded or Custom manager panel.',
      'Confirm hosted bot worker is running — deploy runs node scripts/ensure-hosted-bots.js on start.',
      'Check bot tokens and guild IDs on affected customer instances; re-invite if the bot was kicked.',
      'If stale count stays high, redeploy the service or POST /api/admin/maintenance/run and inspect logs.',
    ],
  }
}

function buildUpstreamNode(
  id: string,
  label: string,
  upstream: { ok: boolean; skipped?: boolean; error?: string },
  envKey: string,
): HealthNodePayload {
  if (upstream.skipped) {
    return {
      id,
      label,
      ok: true,
      status: 'skipped',
      summary: `${envKey} not configured (optional)`,
      metrics: { configured: false },
      resolutionSteps: [
        `This upstream is optional. Set ${envKey} in Railway env if you use ${label} manifest generation.`,
        'When not configured, the platform skips health checks for this node.',
      ],
    }
  }

  if (upstream.ok) {
    return {
      id,
      label,
      ok: true,
      status: 'ok',
      summary: `${label} API responding`,
      metrics: { configured: true },
      resolutionSteps: [`${label} is reachable. No action required.`],
    }
  }

  return {
    id,
    label,
    ok: false,
    status: 'degraded',
    summary: `${label} API not responding`,
    metrics: { configured: true, error: upstream.error || 'ping failed' },
    resolutionSteps: [
      `Verify ${envKey} in Railway points to the correct base URL (no trailing path).`,
      `Test from shell: curl -I $${envKey} — expect HTTP 200, 404, or 405.`,
      `Confirm ${label} service is up and not rate-limiting your server IP.`,
      'If the provider changed domains or keys, update env and redeploy.',
      upstream.error ? `Probe error: ${upstream.error}` : 'Health check uses HEAD with a 5s timeout.',
    ],
  }
}
