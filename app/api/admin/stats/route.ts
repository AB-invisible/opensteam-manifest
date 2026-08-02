import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { getStorageUsage } from '@/app/lib/storage'
import { countPlaceholderManifests, performHealthCheck } from '@/app/lib/platform-health'
import { computeVerifyFunnel } from '@/app/lib/verify-funnel'
import { buildHealthNodes } from '@/app/lib/health-resolution'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [userCount, manifestCount, keyCount, totalRequests, uniqueIps, geoTraffic, discordGens, webGens] = await Promise.all([
      prisma.user.count(),
      prisma.manifest.count(),
      prisma.apiKey.count(),
      prisma.apiUsage.count(),
      prisma.apiUsage.groupBy({
        by: ['ip'],
        _count: { ip: true }
      }).then((res: Array<{ ip: string | null; _count: { ip: number } }>) => res.length),
      prisma.apiUsage.groupBy({
        by: ['userCountry'],
        _count: { _all: true },
        orderBy: { _count: { userCountry: 'desc' } },
        take: 10
      }),
      prisma.webGeneration.count({ where: { source: 'discord' } }),
      prisma.webGeneration.count({ where: { source: 'web' } })
    ])

    const recentUsage = await prisma.apiUsage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { apiKey: { include: { user: true } } }
    })

    // Retrieve hourly data for the last 24 hours using a raw query for precise grouping
    const hourlyData: any[] = await prisma.$queryRaw`
      SELECT date_trunc('hour', "createdAt") as hour, count(*) as count
      FROM api_usage
      WHERE "createdAt" > now() - interval '24 hours'
      GROUP BY 1
      ORDER BY 1 ASC
    `

    // Map raw results into a chronological 24-bucket array (from 24h ago to now)
    const bucketMap = new Map<string, number>()
    for (const row of hourlyData) {
      const d = new Date(row.hour)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      bucketMap.set(key, Number(row.count))
    }

    const chronologicalTraffic: number[] = []
    const hourLabels: string[] = []
    const now = new Date()
    for (let i = 23; i >= 0; i--) {
      const targetTime = new Date(now.getTime() - i * 3600000)
      targetTime.setMinutes(0, 0, 0)
      const key = `${targetTime.getFullYear()}-${targetTime.getMonth()}-${targetTime.getDate()}-${targetTime.getHours()}`
      chronologicalTraffic.push(bucketMap.get(key) ?? 0)
      hourLabels.push(targetTime.toISOString())
    }

    const storage = await getStorageUsage()

    const [genConfig, regConfig, placeholderManifestCount, verifyFunnel, platformHealth] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'GENERATION_ENABLED' } }),
      prisma.systemConfig.findUnique({ where: { key: 'REGISTRATION_ENABLED' } }),
      countPlaceholderManifests(),
      computeVerifyFunnel(24),
      performHealthCheck().catch(() => null),
    ])
    const generationEnabled = genConfig ? genConfig.value === 'true' : true
    const registrationEnabled = regConfig ? regConfig.value === 'true' : true

    const healthNodes = platformHealth ? buildHealthNodes(platformHealth) : []

    return NextResponse.json({
      users: userCount,
      manifests: manifestCount,
      keys: keyCount,
      totalRequests,
      uniqueIps,
      geoTraffic,
      recentUsage,
      storageUsed: storage.totalBytes,
      storageManifests: storage.manifestCount,
      localBufferUsed: storage.localBufferBytes,
      discordGens,
      webGens,
      hourlyTraffic: chronologicalTraffic,
      hourLabels,
      generationEnabled,
      registrationEnabled,
      placeholderManifestCount,
      verifyFunnel,
      platformHealth: platformHealth
        ? { healthy: platformHealth.healthy, nodes: healthNodes, checks: platformHealth.checks }
        : null,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin Stats Error]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
