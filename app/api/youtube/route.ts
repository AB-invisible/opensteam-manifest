import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

export const dynamic = 'force-dynamic'

/** maxresdefault.jpg is missing for many videos; hqdefault always exists. */
function youtubeThumbnailUrl(videoId: string, stored?: string | null): string {
  const hq = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  if (!stored?.trim() || stored.includes('maxresdefault')) return hq
  return stored
}

function pickApiThumbnail(thumbnails: Record<string, { url?: string } | undefined>): string | undefined {
  return (
    thumbnails.high?.url ||
    thumbnails.standard?.url ||
    thumbnails.medium?.url ||
    thumbnails.maxres?.url ||
    thumbnails.default?.url
  )
}

async function resolveUploadsPlaylistId(apiKey: string, channelId: string): Promise<string | null> {
  const id = channelId.trim()
  if (!apiKey || !id) return null

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('key', apiKey)
    url.searchParams.set('id', id)
    url.searchParams.set('part', 'contentDetails')

    const response = await fetch(url)
    if (response.ok) {
      const data = await response.json()
      const uploads = data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined
      if (uploads) return uploads
      return null
    }
  } catch {
    // fall through
  }

  if (id.startsWith('UC') && id.length > 10) {
    return `UU${id.slice(2)}`
  }

  return null
}

export async function GET() {
  const API_KEY = process.env.YOUTUBE_API_KEY
  const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || ''

  if (API_KEY && CHANNEL_ID) {
    try {
      const uploadsPlaylistId = await resolveUploadsPlaylistId(API_KEY, CHANNEL_ID)
      if (!uploadsPlaylistId) {
        console.warn(`[YouTube Sync] Could not resolve uploads playlist for channel ${CHANNEL_ID}`)
      } else {
        const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
        playlistUrl.searchParams.set('key', API_KEY)
        playlistUrl.searchParams.set('playlistId', uploadsPlaylistId)
        playlistUrl.searchParams.set('part', 'snippet')
        playlistUrl.searchParams.set('maxResults', '6')

        const response = await fetch(playlistUrl)

        if (response.ok) {
          const data = await response.json()

          if (data.items && data.items.length > 0) {
            const syncPromises = data.items
              .filter((item: any) => item.snippet?.resourceId?.videoId)
              .map((item: any) => {
                const videoId = item.snippet.resourceId.videoId
                return prisma.youTubeVideo.upsert({
                  where: { id: videoId },
                  update: {
                    title: item.snippet.title,
                    thumbnail: pickApiThumbnail(item.snippet.thumbnails) || youtubeThumbnailUrl(videoId),
                    publishedAt: new Date(item.snippet.publishedAt)
                  },
                  create: {
                    id: videoId,
                    title: item.snippet.title,
                    thumbnail: pickApiThumbnail(item.snippet.thumbnails) || youtubeThumbnailUrl(videoId),
                    publishedAt: new Date(item.snippet.publishedAt)
                  }
                })
              })
            await Promise.all(syncPromises)
          }
        } else {
          const err = await response.json().catch(() => ({}))
          console.warn('[YouTube Sync] playlistItems failed:', err?.error?.message || response.status)
        }
      }
    } catch (error) {
      console.error('YouTube Sync Error:', error)
    }
  }

  // 2. Fetch latest videos from Database
  try {
    const dbVideos = await prisma.youTubeVideo.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 6
    })

    if (dbVideos.length > 0) {
      return NextResponse.json({ 
        videos: dbVideos.map(v => ({
          ...v,
          thumbnail: youtubeThumbnailUrl(v.id, v.thumbnail),
          publishedAt: v.publishedAt.toISOString()
        }))
      })
    }
  } catch (dbError) {
    console.error('Database Video Fetch Error:', dbError)
  }

  // 3. Absolute Fallback (if everything fails)
  const fallbackVideos = [
    {
      id: 'dubBU9c6Uzg',
      title: 'Steam Manifest Tutorial - How to use OpenSteam Platform',
      thumbnail: youtubeThumbnailUrl('dubBU9c6Uzg'),
      publishedAt: new Date(Date.now() - 86400000 * 2).toISOString()
    }
  ]

  return NextResponse.json({ videos: fallbackVideos })
}
