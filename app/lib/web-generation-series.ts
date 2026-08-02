import { prisma } from './prisma'
import type { ApiUsageChartsData, UsageSeriesPoint } from '@/app/lib/usage-chart-types'
import { DAILY_CHART_DAYS, dailyChartSqlCutoff } from '@/app/lib/chart-daily-window'

type RawRow = {
  period_start: Date
  total: bigint
  success: bigint
  unique_ips: bigint
}

function toPoints(rows: RawRow[]): UsageSeriesPoint[] {
  return rows.map((r) => ({
    period: r.period_start.toISOString().slice(0, 10),
    requests: Number(r.total),
    success: Number(r.success),
    uniqueIps: Number(r.unique_ips),
  }))
}

function fillMissingDays(days: number, rows: UsageSeriesPoint[], now = new Date()): UsageSeriesPoint[] {
  const byKey = new Map(rows.map((p) => [p.period, p]))
  const out: UsageSeriesPoint[] = []
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const key = d.toISOString().slice(0, 10)
    out.push(byKey.get(key) || { period: key, requests: 0, success: 0, uniqueIps: 0 })
  }
  return out
}

/**
 * Web (and Discord-tracked) manifest generations per UTC bucket for one user.
 * `uniqueIps` field holds COUNT(DISTINCT appId) per period for chart line (variety of games).
 */
export async function getWebGenerationTimeSeries(userId: string): Promise<ApiUsageChartsData> {
  if (!userId) {
    return { daily: [], weekly: [], monthly: [] }
  }

  const now = new Date()
  const dayCutoff = dailyChartSqlCutoff(now, DAILY_CHART_DAYS)

  const [dailyAgg, weekRows, monthRows] = await Promise.all([
    prisma.$queryRawUnsafe<RawRow[]>(
      `SELECT
         (date_trunc('day', "createdAt" AT TIME ZONE 'UTC'))::date AS period_start,
         COUNT(*)::bigint AS total,
         COUNT(*)::bigint AS success,
         COUNT(DISTINCT "appId")::bigint AS unique_ips
       FROM web_generations
       WHERE "userId" = $1
         AND "createdAt" >= $2::timestamptz
       GROUP BY 1
       ORDER BY 1 ASC`,
      userId,
      dayCutoff
    ),
    prisma.$queryRawUnsafe<RawRow[]>(
      `WITH anchors AS (
         SELECT (date_trunc('week', (NOW() AT TIME ZONE 'UTC')::timestamptz))::date AS cur_week
       ),
       weeks AS (
         SELECT (a.cur_week - ((11 - gs.i) * 7))::date AS period_start
         FROM anchors a
         CROSS JOIN generate_series(0, 11) AS gs(i)
       )
       SELECT
         w.period_start,
         COALESCE(u.cnt, 0)::bigint AS total,
         COALESCE(u.succ, 0)::bigint AS success,
         COALESCE(u.ips, 0)::bigint AS unique_ips
       FROM weeks w
       LEFT JOIN (
         SELECT
           (date_trunc('week', "createdAt" AT TIME ZONE 'UTC'))::date AS ws,
           COUNT(*)::bigint AS cnt,
           COUNT(*)::bigint AS succ,
           COUNT(DISTINCT "appId")::bigint AS ips
         FROM web_generations
         WHERE "userId" = $1
         GROUP BY 1
       ) u ON u.ws = w.period_start
       ORDER BY w.period_start ASC`,
      userId
    ),
    prisma.$queryRawUnsafe<RawRow[]>(
      `WITH anchors AS (
         SELECT (date_trunc('month', (NOW() AT TIME ZONE 'UTC')::timestamptz))::date AS cur_month
       ),
       months AS (
         SELECT (a.cur_month - ((11 - gs.i) * interval '1 month'))::date AS period_start
         FROM anchors a
         CROSS JOIN generate_series(0, 11) AS gs(i)
       )
       SELECT
         m.period_start,
         COALESCE(u.cnt, 0)::bigint AS total,
         COALESCE(u.succ, 0)::bigint AS success,
         COALESCE(u.ips, 0)::bigint AS unique_ips
       FROM months m
       LEFT JOIN (
         SELECT
           (date_trunc('month', "createdAt" AT TIME ZONE 'UTC'))::date AS ms,
           COUNT(*)::bigint AS cnt,
           COUNT(*)::bigint AS succ,
           COUNT(DISTINCT "appId")::bigint AS ips
         FROM web_generations
         WHERE "userId" = $1
         GROUP BY 1
       ) u ON u.ms = m.period_start
       ORDER BY m.period_start ASC`,
      userId
    ),
  ])

  return {
    daily: fillMissingDays(DAILY_CHART_DAYS, toPoints(dailyAgg), now),
    weekly: toPoints(weekRows),
    monthly: toPoints(monthRows),
  }
}
