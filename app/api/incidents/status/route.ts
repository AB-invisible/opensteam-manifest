import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { getCommunityBotIncidentStatus, performHealthCheck } from '@/app/lib/platform-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const statuses = {
    website: 'operational',
    ryuu: 'operational',
    morrenus: 'operational',
    s3: 'operational',
    firewall: 'operational',
    bot: 'operational',
  };

  const latency = {
    website: 0,
    ryuu: 0,
    morrenus: 0,
    s3: 0,
  };

  // Run all checks in parallel for speed
  await Promise.allSettled([
    // 1. Website & Database
    (async () => {
      const dbStart = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        latency.website = Date.now() - dbStart;
        statuses.website = 'operational';
      } catch {
        statuses.website = 'major_outage';
      }
    })(),

    // 2. S3 Cloud Storage
    (async () => {
      const hasS3 = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME);
      statuses.s3 = hasS3 ? 'operational' : 'degraded';
    })(),

    // 3. Ryuu Manifest Generator
    (async () => {
      const ryuuStart = Date.now();
      try {
        const res = await fetch('https://generator.ryuu.lol/', {
          method: 'HEAD',
          signal: AbortSignal.timeout(4000)
        });
        latency.ryuu = Date.now() - ryuuStart;
        statuses.ryuu = res.status < 500 ? 'operational' : 'degraded';
      } catch {
        statuses.ryuu = 'major_outage';
      }
    })(),

    // 4. Morrenus Fallback API
    (async () => {
      const morStart = Date.now();
      try {
        const res = await fetch('https://hubcapmanifest.com/', {
          method: 'HEAD',
          signal: AbortSignal.timeout(4000)
        });
        latency.morrenus = Date.now() - morStart;
        statuses.morrenus = res.status < 500 ? 'operational' : 'degraded';
      } catch {
        statuses.morrenus = 'major_outage';
      }
    })(),

    // 5 & 6. Firewall + Bot (DB-dependent, run after website check settles)
    (async () => {
      try {
        statuses.firewall = 'operational';
        statuses.bot = await getCommunityBotIncidentStatus();
      } catch {
        statuses.firewall = 'degraded';
        statuses.bot = 'major_outage';
      }
    })(),
  ]);

  // ── Real uptime calculation from incident history ──────────────────────
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  let uptimePercent = 100;
  // dailyHistory: array of 90 entries (oldest→newest), each: 'operational'|'degraded'|'outage'
  const dailyHistory: string[] = new Array(90).fill('operational');

  try {
    const incidents = await prisma.incident.findMany({
      where: { createdAt: { gte: ninetyDaysAgo } },
      include: { updates: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

    // Mark affected days
    let outrageDays = new Set<number>();
    let degradedDays = new Set<number>();

    for (const incident of incidents) {
      const start = new Date(incident.createdAt);
      // Find resolution time (last resolved/completed update), or use now if still open
      const resolvedUpdate = [...incident.updates].reverse().find(u =>
        u.type === 'resolved' || u.type === 'completed'
      );
      const end = resolvedUpdate ? new Date(resolvedUpdate.createdAt) : new Date();

      // Mark every day within the incident window
      const cur = new Date(start);
      cur.setHours(0, 0, 0, 0);
      while (cur <= end) {
        const daysAgo = Math.floor((Date.now() - cur.getTime()) / 86400000);
        const idx = 89 - daysAgo;
        if (idx >= 0 && idx < 90) {
          if (incident.severity === 'major') outrageDays.add(idx);
          else if (incident.severity === 'minor' || incident.severity === 'maintenance') degradedDays.add(idx);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    for (let i = 0; i < 90; i++) {
      if (outrageDays.has(i)) dailyHistory[i] = 'outage';
      else if (degradedDays.has(i)) dailyHistory[i] = 'degraded';
    }

    // Uptime = (days without outage / 90) * 100, rounded to 2dp
    const outageDayCount = outrageDays.size;
    uptimePercent = Math.round(((90 - outageDayCount) / 90) * 10000) / 100;
  } catch {
    // If DB fails, keep defaults
  }

  const platformHealth = await performHealthCheck().catch(() => null)
  if (platformHealth) {
    if (!platformHealth.checks.database.ok) statuses.website = 'major_outage'
    if (!platformHealth.checks.hostedBots.ok) statuses.bot = 'degraded'
    if (platformHealth.checks.upstreamRyuu.skipped === false && !platformHealth.checks.upstreamRyuu.ok) {
      statuses.ryuu = 'degraded'
    }
    if (platformHealth.checks.upstreamMorrenus.skipped === false && !platformHealth.checks.upstreamMorrenus.ok) {
      statuses.morrenus = 'degraded'
    }
  }

  return NextResponse.json({
    success: true,
    statuses,
    latency,
    uptimePercent,
    dailyHistory,
    platformHealth,
    timestamp: new Date().toISOString()
  });
}
