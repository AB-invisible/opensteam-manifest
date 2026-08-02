import type { Plan } from '@prisma/client'
import { fetchManifestFromMorrenus } from '@/app/lib/morrenus'
import { fetchManifestFromRyuu } from '@/app/lib/ryuu'
import { canAccessRyuu, canUseMorrenusFallback } from '@/app/lib/config'

export type UpstreamGateUser = {
  plan: Plan
  customAllowRyuu?: boolean | null
  customAllowMorrenus?: boolean | null
}

/**
 * Fetches a ZIP from Ryuu and/or Morrenus according to plan and admin overrides.
 */
export async function fetchManifestZipWithPlanGates(
  appId: string,
  user: UpstreamGateUser
): Promise<{ ok: true; zipBuffer: Buffer } | { ok: false; reason: 'forbidden' | 'not_found' }> {
  const hasRyuu = canAccessRyuu(user)
  const hasMorrenus = canUseMorrenusFallback(user)

  if (!hasRyuu && !hasMorrenus) {
    return { ok: false, reason: 'forbidden' }
  }

  if (hasRyuu) {
    let result = await fetchManifestFromRyuu(appId)
    if (result.success && result.zipBuffer) {
      return { ok: true, zipBuffer: result.zipBuffer }
    }
    if (hasMorrenus) {
      result = await fetchManifestFromMorrenus(appId)
      if (result.success && result.zipBuffer) {
        return { ok: true, zipBuffer: result.zipBuffer }
      }
    }
    return { ok: false, reason: 'not_found' }
  }

  const result = await fetchManifestFromMorrenus(appId)
  if (result.success && result.zipBuffer) {
    return { ok: true, zipBuffer: result.zipBuffer }
  }
  return { ok: false, reason: 'not_found' }
}
