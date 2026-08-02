import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { User } from '@prisma/client'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { persistManifest } from '@/app/lib/storage'
import { cleanManifestZip } from '@/app/lib/clean-manifest'
import { sendWebhook } from '@/app/lib/webhooks'
import { updateDiscordGameRequest } from '@/app/lib/discord-requests'
import { verifyAdminApiKeyFromRequest } from '@/app/lib/admin-api-key'
import { getClientIp } from '@/app/lib/ip'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import { announceGameAdded } from '@/app/lib/discord-game-added'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isMultipartTruncationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /unexpected end of form|form data has been consumed|aborted|ECONNRESET/i.test(message)
}

async function resolveSystemUploadUser() {
  const operatorDiscordId = process.env.UPLOAD_OPERATOR_DISCORD_ID?.trim()
  return (operatorDiscordId
    ? await prisma.user.findUnique({ where: { discordId: operatorDiscordId } })
    : null)
    || await prisma.user.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })
    || await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    })
}

async function authorizeManifestUpload(request: NextRequest): Promise<
  | { ok: false }
  | { ok: true; user: User; method: 'api-key' | 'session' }
> {
  if (verifyAdminApiKeyFromRequest(request)) {
    const user = await resolveSystemUploadUser()
    return user ? { ok: true, user, method: 'api-key' } : { ok: false }
  }

  const session = await getServerSession(authOptions)
  const discordId = (session?.user as { discordId?: string } | undefined)?.discordId
  if (!discordId) return { ok: false }

  const user = await prisma.user.findUnique({ where: { discordId } })
  if (!user || !['OWNER', 'ADMIN'].includes(user.role)) return { ok: false }

  return { ok: true, user, method: 'session' }
}

async function readUploadFormData(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new Error('INVALID_CONTENT_TYPE')
  }

  try {
    return await request.formData()
  } catch (error) {
    if (isMultipartTruncationError(error)) {
      throw new Error('TRUNCATED_MULTIPART')
    }
    throw error
  }
}

/**
 * POST /api/manifests/upload
 *
 * Upload a zip file for a manifest.
 * Supports files up to 5GB.
 * Auth: Admin API key (bulk scripts) or signed-in OWNER/ADMIN session (dashboard).
 *
 * Form data:
 *   - file: The zip file
 *   - appId: Steam App ID (used as the manifest identifier)
 *   - name: Optional display name
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const auth = await authorizeManifestUpload(request)
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in as owner/admin or provide a valid Admin API key.' },
        { status: 401, headers }
      )
    }

    const user = auth.user

    if (auth.method === 'api-key') {
      await prisma.sentinelLog.create({
        data: {
          action: 'ADMIN_OVERRIDE',
          ip: getClientIp(request),
          userAgent: request.headers.get('user-agent'),
          score: 0,
          reason: 'Authorized Admin API Key used for Bulk Upload',
          details: {
            method: 'X-API-Key/Bearer',
            target: 'Manifest Upload',
          },
        },
      }).catch((e) => console.error('[Sentinel] Failed to log admin override:', e))
    }

    let formData: FormData
    try {
      formData = await readUploadFormData(request)
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_CONTENT_TYPE') {
        return NextResponse.json(
          { error: 'Content-Type must be multipart/form-data with a file field.' },
          { status: 400, headers }
        )
      }
      if (error instanceof Error && error.message === 'TRUNCATED_MULTIPART') {
        return NextResponse.json(
          {
            error:
              'Upload body was cut off before the server finished reading it. ' +
              'Use a smaller file, retry the upload, or raise your reverse-proxy body size limit.',
          },
          { status: 413, headers }
        )
      }
      throw error
    }

    const file = formData.get('file') as File | null
    const appId = formData.get('appId') as string | null
    const name = formData.get('name') as string | null

    if (!file || !appId) {
      return NextResponse.json(
        { error: 'file and appId are required' },
        { status: 400, headers }
      )
    }

    // Steam App IDs are always numeric. Reject anything else — this guards
    // against upload scripts that accidentally send the game name as the appId
    // (e.g. when zips have been renamed from "12345.zip" to "Game Name.zip").
    if (!/^\d+$/.test(appId.trim())) {
      return NextResponse.json(
        { error: `Invalid appId "${appId}" — must be a numeric Steam App ID (e.g. 730, 570). Check that your upload script is not using the filename as the appId.` },
        { status: 400, headers }
      )
    }

    // Validate file extension and type
    const allowedExtensions = ['.zip', '.rar', '.7z']
    const isAllowedExt = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    
    // Some common MIME types for these formats
    const allowedMimes = [
      'application/zip', 
      'application/x-zip-compressed',
      'application/x-rar-compressed', 
      'application/vnd.rar',
      'application/x-7z-compressed',
      'application/octet-stream' // Often used for compressed files
    ]
    const isAllowedMime = allowedMimes.includes(file.type)

    if (!isAllowedExt && !isAllowedMime) {
      console.warn('[Upload] Invalid file rejected:', { 
        name: file.name, 
        type: file.type, 
        isAllowedExt, 
        isAllowedMime 
      });
      return NextResponse.json(
        { error: `Invalid file format. Only ZIP, RAR, or 7Z are allowed. Received: ${file.name} (${file.type})` },
        { status: 400, headers }
      )
    }

    // 5GB limit
    const MAX_SIZE = 5 * 1024 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is 5GB` },
        { status: 413, headers }
      )
    }

    const appIdStr = String(appId)

    // Write zip to volume storage & move to S3 if configured
    const rawBuffer = Buffer.from(await file.arrayBuffer())
    // Strip prior-source attribution from the lua and prepend the OpenSteam credit
    // before we persist, so every manifest we serve is branded with our header.
    const buffer = await cleanManifestZip(rawBuffer)
    const { storageType } = await persistManifest(appIdStr, buffer)

    // Check if it's new
    const existingManifest = await prisma.manifest.findUnique({
      where: { steamAppId: appIdStr }
    })

    // Resolve a real game name + verified header image from Steam.
    // Steam's appdetails endpoint is heavily rate-limited (~200/5min per IP)
    // and concurrent bulk uploads can easily trip 429s / timeouts, which is
    // why bulk uploads previously got intermittent placeholder names. We
    // retry with exponential backoff and a longer timeout to ride through
    // transient throttling. Stragglers can still be cleaned up via the
    // /api/admin/manifests/backfill endpoint or the admin "Backfill Names"
    // button.
    const incomingName = name?.trim() || ''
    const isPlaceholder = /^(Manifest|App)\s+\d+$/i.test(incomingName)
    let resolvedName = isPlaceholder ? '' : incomingName
    let resolvedImageUrl: string | undefined
    let resolvedShortDescription: string | undefined

    const STEAM_RETRY_DELAYS_MS = [0, 800, 2200] // ~3 attempts over <4s wall-clock
    for (let attempt = 0; attempt < STEAM_RETRY_DELAYS_MS.length; attempt++) {
      if (STEAM_RETRY_DELAYS_MS[attempt] > 0) {
        await new Promise(r => setTimeout(r, STEAM_RETRY_DELAYS_MS[attempt]))
      }
      try {
        // cc=us is more reliable than the request-IP-default region;
        // Steam returns success:false for some games in certain regions.
        const steamRes = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${appIdStr}&l=english&cc=us`,
          { signal: AbortSignal.timeout(8000) }
        )
        if (steamRes.status === 429) {
          console.warn(`[Upload] Steam 429 for ${appIdStr}, attempt ${attempt + 1}`)
          continue // backoff + retry
        }
        if (!steamRes.ok) {
          console.warn(`[Upload] Steam HTTP ${steamRes.status} for ${appIdStr}`)
          break // non-429 HTTP error: don't waste retries
        }
        const steamJson: any = await steamRes.json()
        const node = steamJson?.[appIdStr]
        if (!node) { break }
        if (node.success === false) { break } // Steam genuinely doesn't know this app
        if (node.data) {
          const sd = node.data
          if (!resolvedName && sd.name) resolvedName = String(sd.name).slice(0, 200)
          if (sd.header_image) resolvedImageUrl = String(sd.header_image)
          if (sd.short_description) resolvedShortDescription = String(sd.short_description)
        }
        break // success
      } catch (e: any) {
        console.warn(`[Upload] Steam lookup attempt ${attempt + 1} failed for ${appIdStr}:`, e?.message)
        // loop continues for next retry
      }
    }
    if (!resolvedName) {
      console.warn(`[Upload] Falling back to placeholder name for ${appIdStr} — Backfill Names can fix this later`)
      resolvedName = `Manifest ${appIdStr}`
    }

    // Upsert manifest record
    const existingIsPlaceholder = /^(Manifest|App)\s+\d+$/i.test(existingManifest?.name || '')
    const manifest = await prisma.manifest.upsert({
      where: { steamAppId: appIdStr },
      update: {
        // - Real custom name from uploader → use it
        // - Existing name is the legacy placeholder → upgrade to Steam name
        // - Otherwise leave the stored name alone (admin may have set a custom one)
        name: (!isPlaceholder && incomingName)
          ? incomingName
          : (existingIsPlaceholder ? resolvedName : undefined),
        fileSize: BigInt(buffer.length),
        updatedAt: new Date()
      },
      create: {
        steamAppId: appIdStr,
        name: resolvedName,
        fileSize: BigInt(buffer.length),
        userId: user.id
      }
    })

    // Find any pending requests for this appId so we can ping the requesters
    // and mark their tickets as fulfilled.
    const pendingRequests = await prisma.gameRequest.findMany({
      where: { appId: appIdStr, status: 'PENDING' },
      include: { user: { select: { discordId: true } } }
    })

    const requesterDiscordIds = Array.from(
      new Set(pendingRequests.map(r => r.user.discordId).filter(Boolean))
    )

    if (pendingRequests.length > 0) {
      await prisma.gameRequest.updateMany({
        where: { id: { in: pendingRequests.map(r => r.id) } },
        data: { status: 'FULFILLED' }
      })
      // Edit each request's original Discord message to ADDED status (and ping the requester there too)
      for (const req of pendingRequests) {
        void updateDiscordGameRequest(req.id)
      }
    }

    void sendWebhook(existingManifest ? 'GAME_UPDATED' : 'GAME_ADDED', {
      gameName: manifest.name,
      appId: manifest.steamAppId,
      userId: user.id,
      username: user.username,
      imageUrl: resolvedImageUrl,
      requesterDiscordIds
    })

    const isNew = !existingManifest
    if (isNew) {
      void announceGameAdded({
        appId: manifest.steamAppId,
        gameName: manifest.name,
        imageUrl: resolvedImageUrl,
        shortDescription: resolvedShortDescription,
      })
    }

    const baseUrl = getPublicAppUrl()
    if (!baseUrl) {
      console.error('[manifests/upload] NEXT_PUBLIC_APP_URL is required in production')
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500, headers })
    }

    return NextResponse.json({
      success: true,
      isNew,
      imageUrl: resolvedImageUrl || null,
      manifest: {
        id: manifest.id,
        appId: appIdStr,
        name: manifest.name,
        downloadUrl: `${baseUrl}/api/download/${appIdStr}`,
        fileSize: buffer.length,
        uploadedAt: new Date().toISOString(),
        storageType
      }
    }, { headers })

  } catch (error) {
    if (isMultipartTruncationError(error)) {
      console.error('[manifests/upload] truncated multipart body:', error)
      return NextResponse.json(
        {
          error:
            'Upload body was cut off before the server finished reading it. ' +
            'Use a smaller file, retry the upload, or raise your reverse-proxy body size limit.',
        },
        { status: 413, headers }
      )
    }
    console.error('Error uploading zip:', error)
    return NextResponse.json(
      { error: 'Failed to upload zip file' },
      { status: 500, headers }
    )
  }
}
