'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, RefreshCw, Sparkles } from 'lucide-react'

export type HealthNode = {
  id: string
  label: string
  ok: boolean
  status?: 'ok' | 'degraded' | 'skipped'
  summary?: string
  metrics?: Record<string, string | number | boolean>
  resolutionSteps?: string[]
}

type NavigateTab =
  | 'overview'
  | 'manifests'
  | 'settings'
  | 'hosted-bots'
  | 'logs'
  | 'users'
  | 'keys'
  | 'firewall'
  | 'diagnostics'

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

/** 24h API traffic from api_usage table. */
export function TrafficHeatmap({
  hourlyTraffic,
  hourLabels,
}: {
  hourlyTraffic: number[]
  hourLabels?: string[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const data = hourlyTraffic?.length === 24 ? hourlyTraffic : Array(24).fill(0)
  const maxVal = Math.max(1, ...data)
  const total = data.reduce((a, b) => a + b, 0)
  const peakIdx = data.indexOf(Math.max(...data))

  const formatHour = (i: number) => {
    if (hourLabels?.[i]) {
      return new Date(hourLabels[i]).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    const d = new Date(Date.now() - (23 - i) * 3600000)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs font-bold">
        <span className="text-white/70">Hourly Spectrum (Last 24h)</span>
        <span className="text-indigo-400 text-[10px] font-black uppercase tracking-wider">
          {total.toLocaleString()} requests
        </span>
      </div>
      <div className="grid grid-cols-24 gap-1 px-0.5">
        {data.map((val, i) => {
          const intensity = val / maxVal
          const isPeak = i === peakIdx && val > 0
          const isHovered = hovered === i
          return (
            <button
              key={i}
              type="button"
              className={`h-10 rounded-md border transition-all focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                isHovered || isPeak ? 'scale-110 z-10 border-indigo-400/60' : 'border-white/5'
              } ${
                intensity > 0.8
                  ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.7)]'
                  : intensity > 0.5
                    ? 'bg-indigo-500/70'
                    : intensity > 0.2
                      ? 'bg-indigo-500/40'
                      : val > 0
                        ? 'bg-indigo-500/15'
                        : 'bg-white/5'
              }`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              aria-label={`${formatHour(i)}: ${val} requests`}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[8px] uppercase font-black text-muted-foreground tracking-widest px-0.5">
        <span>24h ago</span>
        <span>12h ago</span>
        <span>Now</span>
      </div>
      {hovered !== null && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[10px]">
          <span className="font-black text-white">{formatHour(hovered)}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-indigo-300 font-bold">{data[hovered].toLocaleString()} requests</span>
          <span className="text-muted-foreground"> ({pct(data[hovered], total)}% of 24h)</span>
        </div>
      )}
    </div>
  )
}

/** Web vs Discord generations from web_generations table. */
export function GenerationAnalyticsChart({
  webGens,
  discordGens,
}: {
  webGens: number
  discordGens: number
}) {
  const [hovered, setHovered] = useState<'web' | 'discord' | null>(null)
  const total = webGens + discordGens
  const webPct = total > 0 ? (webGens / total) * 100 : 0
  const discordPct = total > 0 ? (discordGens / total) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-xs font-bold">
        <span className="text-white/70">Generation Distribution</span>
        <span className="text-white font-mono text-[11px]">{total.toLocaleString()} total</span>
      </div>
      {[
        { id: 'web' as const, label: 'Web Application', value: webGens, pct: webPct, color: 'bg-emerald-500' },
        { id: 'discord' as const, label: 'Discord Bot', value: discordGens, pct: discordPct, color: 'bg-indigo-500' },
      ].map((row) => (
        <button
          key={row.id}
          type="button"
          className={`w-full text-left space-y-2 rounded-xl p-2 -mx-2 transition-colors ${
            hovered === row.id ? 'bg-white/5' : ''
          }`}
          onMouseEnter={() => setHovered(row.id)}
          onMouseLeave={() => setHovered(null)}
        >
          <div className="flex justify-between text-[10px] font-black uppercase tracking-wider text-muted-foreground">
            <span>{row.label}</span>
            <span className="text-white">
              {row.value.toLocaleString()}
              <span className="text-white/40 ml-1">({Math.round(row.pct)}%)</span>
            </span>
          </div>
          <div className="h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${row.color}`}
              style={{ width: `${row.pct}%` }}
            />
          </div>
        </button>
      ))}
      <div className="pt-2 border-t border-white/5 flex justify-between text-[9px] font-black uppercase tracking-widest text-indigo-400">
        <span>Captured Requests</span>
        <span className="text-white font-mono">{total.toLocaleString()} units</span>
      </div>
    </div>
  )
}

/** Storage bar from getStorageUsage(). */
export function StorageUsageBar({ storageUsedBytes }: { storageUsedBytes: number }) {
  const gb = storageUsedBytes / (1024 * 1024 * 1024)
  const limitGb = 10
  const pctUsed = Math.min(100, (gb / limitGb) * 100)
  const level = gb > 8 ? 'critical' : gb > 5 ? 'warn' : 'ok'

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs font-bold">
        <span className="text-white/70">Disk Storage Volume</span>
        <span className="text-white font-mono">
          {gb.toFixed(2)} GB / {limitGb} GB
        </span>
      </div>
      <div className="h-3.5 bg-white/5 rounded-full overflow-hidden border border-white/10 p-0.5">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            level === 'critical'
              ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
              : level === 'warn'
                ? 'bg-amber-500'
                : 'bg-indigo-500'
          }`}
          style={{ width: `${pctUsed}%` }}
        />
      </div>
      {level !== 'ok' && (
        <p className="text-[10px] font-medium text-amber-300/90">
          {level === 'critical'
            ? 'Disk volume near capacity — consider archiving older manifests.'
            : 'Over 50% storage capacity reached.'}
        </p>
      )}
    </div>
  )
}

export function VerifyFunnelChart({
  counts,
  completionRate,
  failureRate,
  sessionsByStatus,
  onNavigate,
}: {
  counts: Record<string, number>
  completionRate: number
  failureRate: number
  sessionsByStatus?: Record<string, number>
  onNavigate?: (tab: NavigateTab) => void
}) {
  const [activeStage, setActiveStage] = useState<string | null>(null)
  const stages = [
    { key: 'SESSION_CREATED', label: 'Started', color: '#818cf8' },
    { key: 'SESSION_VALIDATED', label: 'Link opened', color: '#6366f1' },
    { key: 'OAUTH_STARTED', label: 'OAuth started', color: '#4f46e5' },
    { key: 'OAUTH_COMPLETE', label: 'OAuth done', color: '#4338ca' },
    { key: 'VERIFICATION_COMPLETE', label: 'Completed', color: '#10b981' },
  ]

  const max = Math.max(1, ...stages.map((s) => counts[s.key] || 0))
  const started = counts.SESSION_CREATED || 0

  return (
    <div className="space-y-3.5 flex flex-col justify-between h-full">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
        <span className="text-white/80">Verification Funnel</span>
        <button
          type="button"
          onClick={() => onNavigate?.('settings')}
          className="text-emerald-400 hover:text-emerald-300 transition-colors font-bold"
        >
          {Math.round(completionRate * 100)}% complete →
        </button>
      </div>

      <div className="space-y-1.5 flex-1">
        {stages.map((stage, i) => {
          const value = counts[stage.key] || 0
          const prev = i > 0 ? counts[stages[i - 1].key] || 0 : value
          const dropOff = prev > 0 && i > 0 ? Math.round((1 - value / prev) * 100) : 0
          const ofStarted = started > 0 ? Math.round((value / started) * 100) : 0
          const isActive = activeStage === stage.key

          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => setActiveStage(isActive ? null : stage.key)}
              className={`w-full text-left rounded-xl border px-2.5 py-1.5 transition-all ${
                isActive
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/5 bg-white/[0.02] hover:border-white/15'
              }`}
            >
              <div className="flex justify-between text-[10px] font-bold mb-1">
                <span className="text-white/80 truncate">{stage.label}</span>
                <span className="font-mono text-xs" style={{ color: stage.color }}>{value.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(value / max) * 100}%`,
                    backgroundColor: stage.color,
                  }}
                />
              </div>
              {isActive && (
                <p className="mt-1.5 text-[9px] text-muted-foreground">
                  {ofStarted}% of started
                  {i > 0 && dropOff > 0 ? ` · ${dropOff}% drop-off` : ''}
                </p>
              )}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[9px] space-y-0.5">
        <p className="font-bold text-amber-300">
          Failure Rate {Math.round(failureRate * 100)}%
          {(counts.VPN_BLOCKED || 0) > 0 ? ` · VPN ${counts.VPN_BLOCKED}` : ''}
        </p>
      </div>
    </div>
  )
}

export function ManifestHealthDonut({
  total,
  placeholderCount,
  onNavigate,
}: {
  total: number
  placeholderCount: number
  onNavigate?: (tab: NavigateTab) => void
}) {
  const [segment, setSegment] = useState<'resolved' | 'placeholder' | null>(null)
  const resolved = Math.max(0, total - placeholderCount)
  const pct = total > 0 ? (resolved / total) * 100 : 100
  const r = 46
  const c = 2 * Math.PI * r
  const resolvedLen = (pct / 100) * c
  const placeholderLen = c - resolvedLen

  return (
    <div className="space-y-3.5 flex flex-col justify-between h-full">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0" role="img" aria-label="Manifest name health">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="#10b981"
            strokeWidth="12"
            strokeDasharray={`${resolvedLen} ${placeholderLen}`}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setSegment(segment === 'resolved' ? null : 'resolved')}
          />
          {placeholderCount > 0 && (
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="12"
              strokeDasharray={`${placeholderLen} ${resolvedLen}`}
              strokeDashoffset={-resolvedLen}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              className="cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setSegment(segment === 'placeholder' ? null : 'placeholder')}
            />
          )}
          <text x="60" y="56" textAnchor="middle" fill="white" fontSize="16" fontWeight="800">
            {Math.round(pct)}%
          </text>
          <text x="60" y="70" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8" fontWeight="700" letterSpacing="1">
            NAMED
          </text>
        </svg>

        <div className="space-y-1.5 text-[10px] flex-1 min-w-0">
          {[
            { id: 'resolved' as const, color: 'bg-emerald-500', value: resolved, label: 'Resolved' },
            { id: 'placeholder' as const, color: 'bg-amber-500', value: placeholderCount, label: 'Placeholders' },
          ].map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSegment(segment === row.id ? null : row.id)}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1 transition-colors ${
                segment === row.id ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className={`w-2 h-2 rounded-full shrink-0 ${row.color}`} />
                <span className="text-white/80 truncate">{row.label}</span>
              </div>
              <span className="font-mono font-bold text-white ml-1">{row.value.toLocaleString()}</span>
            </button>
          ))}

          <div className="flex items-center justify-between px-2 pt-1 border-t border-white/5 text-white/50 text-[9px]">
            <span>Total Registry</span>
            <span className="font-mono font-bold text-white/70">{total.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {segment === 'placeholder' && placeholderCount > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[10px] space-y-1.5 animate-in fade-in">
          <p className="font-bold text-amber-200">Steam Title Backfill Needed</p>
          <button
            type="button"
            onClick={() => onNavigate?.('manifests')}
            className="inline-flex items-center gap-1 text-amber-300 font-bold hover:text-amber-200"
          >
            Open Manifests <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

export function PlatformHealthDiagram({
  nodes,
  healthy,
  onNavigate,
  onRefresh,
  refreshing,
}: {
  nodes: HealthNode[]
  healthy?: boolean
  onNavigate?: (tab: NavigateTab) => void
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedNode = nodes.find((n) => n.id === selected)

  const tabForNode = (id: string): NavigateTab | null => {
    if (id === 'bot') return 'settings'
    if (id === 'hosted') return 'hosted-bots'
    if (id === 'storage' || id === 'db') return 'settings'
    return null
  }

  return (
    <div className="space-y-3 flex flex-col justify-between h-full">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-wider text-white/80">
          Subsystem Matrix
        </p>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate?.('diagnostics')}
            className="flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
            title="Run AI Diagnostics"
          >
            <Sparkles className="h-2.5 w-2.5 text-indigo-400" />
            <span>AI Scan</span>
          </button>
        </div>
      </div>

      {/* Grid scaled cleanly to fit cards without clipping labels */}
      <div className="grid grid-cols-2 gap-2 flex-1">
        {nodes.map((node) => {
          const tone = node.status === 'skipped' ? 'zinc' : node.ok ? 'emerald' : 'amber'
          const isSelected = selected === node.id
          const selectedCls =
            tone === 'emerald'
              ? 'border-emerald-500/50 bg-emerald-500/15'
              : tone === 'zinc'
                ? 'border-zinc-500/50 bg-zinc-500/15'
                : 'border-amber-500/50 bg-amber-500/15'
          const statusCls =
            node.ok ? 'text-emerald-400' : node.status === 'skipped' ? 'text-zinc-400' : 'text-amber-400'
          const dotCls =
            node.ok ? 'bg-emerald-400' : node.status === 'skipped' ? 'bg-zinc-500' : 'bg-amber-400 animate-pulse'

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelected(isSelected ? null : node.id)}
              className={`rounded-xl border p-2 text-left transition-all flex flex-col justify-between overflow-hidden ${
                isSelected ? selectedCls : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
              title={node.summary || node.label}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="text-[10px] font-bold text-white truncate max-w-[80%]">
                  {node.label}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
              </div>
              <p className={`text-[8px] font-black uppercase mt-1 tracking-wider ${statusCls}`}>
                {node.status === 'skipped' ? 'Optional' : node.ok ? 'OK' : 'Degraded'}
              </p>
            </button>
          )
        })}
      </div>

      {selectedNode && (
        <div
          className={`rounded-xl border p-3 space-y-2 text-[10px] animate-in fade-in ${
            selectedNode.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/15'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-white">{selectedNode.label}</span>
            <span className={`text-[8px] font-black uppercase ${selectedNode.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
              {selectedNode.ok ? 'OK' : 'Degraded'}
            </span>
          </div>
          <p className="text-[9px] text-muted-foreground line-clamp-2">{selectedNode.summary}</p>
          {tabForNode(selectedNode.id) && !selectedNode.ok && (
            <button
              type="button"
              onClick={() => onNavigate?.(tabForNode(selectedNode.id)!)}
              className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-400 hover:text-indigo-300"
            >
              Open Tab <ChevronRight className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function AdminBarChart({
  title,
  items,
  barColor = '#6366f1',
  onSelectCountry,
}: {
  title: string
  items: { label: string; value: number }[]
  barColor?: string
  onSelectCountry?: (country: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'value' | 'label'>('value')
  const total = items.reduce((s, i) => s + i.value, 0)

  const sorted = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) =>
      sortBy === 'value' ? b.value - a.value : (a.label || '').localeCompare(b.label || ''),
    )
    return copy.slice(0, 7)
  }, [items, sortBy])

  const max = Math.max(1, ...sorted.map((i) => i.value))

  if (!items.length) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-white/10 rounded-2xl p-6 text-center">
        No geographic traffic recorded yet
      </div>
    )
  }

  return (
    <div className="space-y-3 flex flex-col justify-between h-full">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-white/80">{title}</p>
        <div className="flex gap-1">
          {(['value', 'label'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSortBy(mode)}
              className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border transition-colors ${
                sortBy === mode
                  ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300'
                  : 'border-white/10 text-muted-foreground hover:border-white/20'
              }`}
            >
              {mode === 'value' ? 'Top' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5 flex-1">
        {sorted.map((item) => {
          const label = item.label || 'Unknown'
          const isHovered = hovered === label
          return (
            <button
              key={label}
              type="button"
              className={`w-full text-left space-y-1 rounded-lg p-1 transition-colors ${
                isHovered ? 'bg-white/5' : ''
              }`}
              onMouseEnter={() => setHovered(label)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectCountry?.(label)}
            >
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-white/80 truncate max-w-[55%] font-mono">{label}</span>
                <span className="text-white font-mono text-[10px]">
                  {item.value.toLocaleString()}
                  <span className="text-white/40 ml-1">({pct(item.value, total)}%)</span>
                </span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(item.value / max) * 100}%`, backgroundColor: barColor }}
                />
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[9px] text-muted-foreground">{total.toLocaleString()} total requests in top regions</p>
    </div>
  )
}
