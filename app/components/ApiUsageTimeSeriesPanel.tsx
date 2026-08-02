'use client'

import { useId, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { ApiUsageChartsData, UsageSeriesPoint } from '@/app/lib/usage-chart-types'

export type { ApiUsageChartsData, UsageSeriesPoint }

function formatPeriodLabel(period: string, range: 'daily' | 'weekly' | 'monthly'): string {
  const d = new Date(`${period}T00:00:00.000Z`)
  if (range === 'daily') return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  if (range === 'weekly')
    return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function UsageTimeSeriesChart({
  points,
  range,
  gradientId,
  variant,
}: {
  points: UsageSeriesPoint[]
  range: 'daily' | 'weekly' | 'monthly'
  gradientId: string
  variant: 'api' | 'web'
}) {
  if (!points.length) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm border border-dashed border-white/10 rounded-2xl">
        No data in this range yet
      </div>
    )
  }

  const W = 880
  const H = 240
  const padL = 44
  const padR = 12
  const padT = 16
  const padB = 52
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const n = points.length
  const maxReq = Math.max(1, ...points.map((p) => p.requests))
  const maxIp = Math.max(1, ...points.map((p) => p.uniqueIps))
  const slot = innerW / n
  const barW = Math.min(14, slot * 0.38)

  const linePts = points
    .map((p, i) => {
      const cx = padL + slot * (i + 0.5)
      const y = padT + innerH - (p.uniqueIps / maxIp) * innerH
      return `${cx},${y}`
    })
    .join(' ')

  const yTicks = 4
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round((maxReq * (yTicks - i)) / yTicks)
    const y = padT + (innerH * i) / yTicks
    return { v, y }
  })

  const barLegend = variant === 'web' ? 'Web generations' : 'API requests (gens)'
  const lineLegend = variant === 'web' ? 'Unique App IDs' : 'Unique IPs'
  const ariaLabel =
    variant === 'web'
      ? 'Web generations and distinct app IDs over time'
      : 'API generations and requests over time'

  return (
    <div className="w-full overflow-x-auto pb-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[640px] w-full h-auto max-h-[280px]"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(129, 140, 248)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(99, 102, 241)" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {yLabels.map(({ v, y }) => (
          <g key={`${v}-${y}`}>
            <line
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4 6"
            />
            <text x={4} y={y + 4} className="fill-white/35 text-[10px] font-mono">
              {v}
            </text>
          </g>
        ))}

        <text x={padL} y={12} className="text-[10px] font-bold uppercase tracking-widest">
          <tspan className="fill-indigo-300/90">{barLegend}</tspan>
          <tspan className="fill-cyan-300/90"> · {lineLegend}</tspan>
        </text>

        {points.map((p, i) => {
          const cx = padL + slot * (i + 0.5)
          const h = (p.requests / maxReq) * innerH
          const x = cx - barW / 2
          const y = padT + innerH - h
          return (
            <rect
              key={p.period}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 0)}
              rx={3}
              fill={`url(#${gradientId})`}
            />
          )
        })}

        <polyline
          fill="none"
          stroke="rgb(34, 211, 238)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={linePts}
        />
        {points.map((p, i) => {
          const cx = padL + slot * (i + 0.5)
          const y = padT + innerH - (p.uniqueIps / maxIp) * innerH
          return <circle key={`${p.period}-ip`} cx={cx} cy={y} r={3} fill="rgb(34, 211, 238)" />
        })}

        {points.map((p, i) => {
          if (range === 'daily' && n > 14 && i % 2 === 1) return null
          const cx = padL + slot * (i + 0.5)
          return (
            <text
              key={`${p.period}-lbl`}
              x={cx}
              y={H - 18}
              textAnchor="middle"
              className="fill-white/40 text-[9px] font-mono"
            >
              {formatPeriodLabel(p.period, range)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

export function ApiUsageTimeSeriesPanel({
  charts,
  className = '',
  title = 'API generations over time',
  variant = 'api',
}: {
  charts?: ApiUsageChartsData | null
  className?: string
  title?: string
  variant?: 'api' | 'web'
}) {
  const [chartRange, setChartRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const rawId = useId().replace(/:/g, '')
  const gradientId = `barGrad-${rawId}`

  if (!charts || (!charts.daily.length && !charts.weekly.length && !charts.monthly.length)) {
    return null
  }

  return (
    <div className={`glass rounded-3xl p-6 md:p-8 space-y-4 animate-in fade-in slide-in-from-bottom-6 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-400" />
          <span>{title}</span>
        </h2>
        <div className="flex rounded-xl bg-white/5 border border-white/10 p-1 gap-1">
          {(
            [
              ['daily', '30 days'],
              ['weekly', '12 weeks'],
              ['monthly', '12 months'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setChartRange(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${
                chartRange === key
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {variant === 'web'
          ? 'Bars: web manifest generations per period · Line: distinct App IDs · UTC buckets'
          : 'Bars: total API requests (including manifest "gens") per period · Line: distinct IPs · UTC buckets'}
      </p>
      <UsageTimeSeriesChart
        points={
          chartRange === 'daily' ? charts.daily : chartRange === 'weekly' ? charts.weekly : charts.monthly
        }
        range={chartRange}
        gradientId={gradientId}
        variant={variant}
      />
    </div>
  )
}
