import { prisma } from './prisma'
import fs from 'fs/promises'
import path from 'path'
import { isPlaceholderManifestName } from './manifest-filename'

export type HealthCheckResult = {
  healthy: boolean
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string }
    storage: { ok: boolean; path?: string; error?: string }
    communityBot: { ok: boolean; enabled: boolean; error?: string }
    hostedBots: { ok: boolean; running: number; total: number; stale: number }
    upstreamMorrenus: { ok: boolean; skipped?: boolean; error?: string }
    upstreamRyuu: { ok: boolean; skipped?: boolean; error?: string }
  }
}

async function pingUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
    return res.ok || res.status === 405 || res.status === 404
  } catch {
    return false
  }
}

/**
 * Performs platform health checks for maintenance runs and status pages.
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {
    database: { ok: false },
    storage: { ok: false },
    communityBot: { ok: false, enabled: false },
    hostedBots: { ok: true, running: 0, total: 0, stale: 0 },
    upstreamMorrenus: { ok: true, skipped: true },
    upstreamRyuu: { ok: true, skipped: true },
  }

  const dbStart = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = { ok: true, latencyMs: Date.now() - dbStart }
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : 'DB unreachable' }
  }

  const storagePath = process.env.STORAGE_PATH || '/data'
  try {
    await fs.access(path.join(storagePath, 'manifests'))
    checks.storage = { ok: true, path: storagePath }
  } catch {
    try {
      await fs.mkdir(path.join(storagePath, 'manifests'), { recursive: true })
      checks.storage = { ok: true, path: storagePath }
    } catch (mkdirErr) {
      checks.storage = {
        ok: false,
        path: storagePath,
        error: mkdirErr instanceof Error ? mkdirErr.message : 'Storage not writable',
      }
    }
  }

  const botEnabledCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_ENABLED' } })
  const botEnabled = !botEnabledCfg || botEnabledCfg.value !== 'false'
  checks.communityBot = { ok: botEnabled, enabled: botEnabled }

  const hostedInstances = await prisma.hostedBotInstance.findMany({
    select: { status: true, updatedAt: true },
  })
  const staleThreshold = Date.now() - 15 * 60 * 1000
  let running = 0
  let stale = 0
  for (const inst of hostedInstances) {
    if (inst.status === 'ACTIVE') running++
    if (inst.updatedAt.getTime() < staleThreshold && inst.status === 'ACTIVE') stale++
  }
  checks.hostedBots = {
    ok: stale === 0,
    running,
    total: hostedInstances.length,
    stale,
  }

  const morrenusBase = process.env.MORRENUS_API_URL
  if (morrenusBase) {
    checks.upstreamMorrenus = { ok: await pingUrl(morrenusBase), skipped: false }
  }

  const ryuuBase = process.env.RYUU_API_URL
  if (ryuuBase) {
    checks.upstreamRyuu = { ok: await pingUrl(ryuuBase), skipped: false }
  }

  const healthy =
    checks.database.ok &&
    checks.storage.ok &&
    checks.communityBot.ok &&
    checks.hostedBots.ok &&
    (checks.upstreamMorrenus.skipped || checks.upstreamMorrenus.ok) &&
    (checks.upstreamRyuu.skipped || checks.upstreamRyuu.ok)

  return { healthy, checks }
}

/** Count manifests still using placeholder names (Manifest 730 / App 730). */
export async function countPlaceholderManifests(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM manifests
      WHERE name ~* '^(Manifest|App)\\s+[0-9]+$'
    `
    return rows[0]?.count ?? 0
  } catch {
    const manifests = await prisma.manifest.findMany({ select: { name: true }, take: 5000 })
    return manifests.filter((m) => isPlaceholderManifestName(m.name)).length
  }
}
