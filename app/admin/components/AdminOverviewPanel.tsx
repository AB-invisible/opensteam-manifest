'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Activity,
  RefreshCw,
  Users,
  Server,
  Package,
  Database,
  ShieldAlert,
  Gamepad2,
  AlertTriangle,
  Search,
  Key,
  Bot,
  FileText,
  Radio,
  ChevronRight,
  Sparkles,
  Cpu,
} from 'lucide-react'
import {
  TrafficHeatmap,
  GenerationAnalyticsChart,
  StorageUsageBar,
  VerifyFunnelChart,
  ManifestHealthDonut,
  PlatformHealthDiagram,
  AdminBarChart,
} from './AdminCharts'

export type NavigateTab =
  | 'overview'
  | 'users'
  | 'requests'
  | 'keys'
  | 'logs'
  | 'firewall'
  | 'manifests'
  | 'settings'
  | 'hosted-bots'
  | 'verify'
  | 'staff-exams'
  | 'diagnostics'

interface AdminOverviewPanelProps {
  stats: any
  users: any[]
  jails: any[]
  blacklist: any[]
  refreshStats: () => Promise<void>
  statsRefreshing: boolean
  navigateFromChart: (tab: NavigateTab) => void
  reloadTab: (tab: string) => Promise<void>
}

export function AdminOverviewPanel({
  stats,
  users,
  jails,
  blacklist,
  refreshStats,
  statsRefreshing,
  navigateFromChart,
  reloadTab,
}: AdminOverviewPanelProps) {
  // Live Auto-Refresh State
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0)
  const [feedSearch, setFeedSearch] = useState<string>('')
  const [methodFilter, setMethodFilter] = useState<string>('ALL')

  // Auto-refresh timer
  useEffect(() => {
    if (autoRefreshInterval <= 0) return
    const timer = setInterval(() => {
      void refreshStats()
    }, autoRefreshInterval * 1000)
    return () => clearInterval(timer)
  }, [autoRefreshInterval, refreshStats])

  // Calculations
  const newUsers24h = useMemo(() => {
    if (!users || !Array.isArray(users)) return 0
    const cutoff = new Date(Date.now() - 86400000)
    return users.filter((u) => u.createdAt && new Date(u.createdAt) > cutoff).length
  }, [users])

  const totalFirewallBlocks = (jails?.length || 0) + (blacklist?.length || 0)

  const isPlatformHealthy = stats?.platformHealth?.healthy ?? true
  const degradedNodesCount =
    stats?.platformHealth?.nodes?.filter((n: any) => !n.ok && n.status !== 'skipped').length || 0
  const placeholderCount = stats?.placeholderManifestCount || 0
  const storageGB = (stats?.storageUsed || 0) / (1024 * 1024 * 1024)

  // Recent usage filtering
  const filteredRecentUsage = useMemo(() => {
    const usageList: any[] = stats?.recentUsage || []
    return usageList.filter((u) => {
      const matchMethod = methodFilter === 'ALL' || u.method?.toUpperCase() === methodFilter
      const searchLower = feedSearch.toLowerCase()
      const matchSearch =
        !feedSearch ||
        u.endpoint?.toLowerCase().includes(searchLower) ||
        u.apiKey?.user?.username?.toLowerCase().includes(searchLower) ||
        u.ip?.toLowerCase().includes(searchLower) ||
        String(u.status).includes(searchLower)
      return matchMethod && matchSearch
    })
  }, [stats?.recentUsage, feedSearch, methodFilter])

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full pb-8">
      {/* Executive Command Header */}
      <div className="glass rounded-[2rem] p-6 border border-white/10 relative overflow-hidden bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-purple-950/30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
                <Activity className="h-7 w-7 text-indigo-400 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    Command Center
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Live Telemetry
                  </span>
                </div>
                <p className="text-muted-foreground text-xs font-medium mt-0.5">
                  Global infrastructure performance, request routing, and platform health.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* AI Diagnostic Scan Trigger */}
            <button
              type="button"
              onClick={() => navigateFromChart('diagnostics')}
              className="px-3.5 py-2 rounded-2xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>AI Diagnostics</span>
            </button>

            {/* System Operational Status Badge */}
            <div
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-xs font-black tracking-wider ${
                isPlatformHealthy
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isPlatformHealthy ? 'bg-emerald-400 animate-ping' : 'bg-amber-400 animate-pulse'
                }`}
              />
              <span>
                {isPlatformHealthy
                  ? 'All Systems Operational'
                  : `${degradedNodesCount} Subsystems Degraded`}
              </span>
            </div>

            {/* Auto-Refresh Timer Selector */}
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-1.5 text-xs">
              <Radio className="h-4 w-4 text-indigo-400 ml-1.5" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline">
                Auto
              </span>
              <div className="flex items-center gap-1">
                {[
                  { label: 'Off', val: 0 },
                  { label: '10s', val: 10 },
                  { label: '30s', val: 30 },
                  { label: '60s', val: 60 },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setAutoRefreshInterval(opt.val)}
                    className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all ${
                      autoRefreshInterval === opt.val
                        ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                        : 'text-muted-foreground hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Sync Trigger */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-end hidden xl:flex">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Last Sync
                </span>
                <span className="text-xs text-white/70 font-mono font-bold">
                  {stats?.fetchedAt ? new Date(stats.fetchedAt).toLocaleTimeString() : '...'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void refreshStats()}
                disabled={statsRefreshing}
                className="p-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-2xl border border-indigo-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center"
                title="Refresh platform telemetry"
              >
                <RefreshCw className={`h-4.5 w-4.5 ${statsRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Actionable Alerts Banner */}
      {(!isPlatformHealthy || placeholderCount > 0 || storageGB > 8) && (
        <div className="space-y-3">
          {!isPlatformHealthy && (
            <div className="flex items-center justify-between p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-in fade-in">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider">
                    Subsystem Degradation Detected
                  </p>
                  <p className="text-[11px] text-amber-300/80">
                    {degradedNodesCount} platform component(s) reporting issues. Review diagnostic recommendations.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateFromChart('diagnostics')}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-bold rounded-xl border border-amber-500/40 transition-all shrink-0 flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI Diagnostics</span>
              </button>
            </div>
          )}

          {placeholderCount > 0 && (
            <div className="flex items-center justify-between p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 animate-in fade-in">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-indigo-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider">
                    {placeholderCount} Unresolved Manifest Titles
                  </p>
                  <p className="text-[11px] text-indigo-300/80">
                    Some manifests in the registry require Steam title resolution.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateFromChart('manifests')}
                className="px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-xs font-bold rounded-xl border border-indigo-500/40 transition-all shrink-0"
              >
                Open Manifest Manager
              </button>
            </div>
          )}
        </div>
      )}

      {/* Top Executive KPI Cards Matrix */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            label: 'Total Users',
            value: (users?.length || stats?.users || 0).toLocaleString(),
            sub: `+${newUsers24h} in last 24h`,
            icon: Users,
            color: 'text-blue-400',
            border: 'border-blue-500/20',
            bg: 'bg-blue-500/10',
            tab: 'users' as const,
          },
          {
            label: 'API Quota',
            value: (stats?.totalRequests || 0).toLocaleString(),
            sub: `${stats?.uniqueIps || 0} unique IP clients`,
            icon: Server,
            color: 'text-emerald-400',
            border: 'border-emerald-500/20',
            bg: 'bg-emerald-500/10',
            tab: 'requests' as const,
          },
          {
            label: 'Manifest Registry',
            value: (stats?.manifests || 0).toLocaleString(),
            sub: `${placeholderCount} pending backfill`,
            icon: Package,
            color: 'text-purple-400',
            border: 'border-purple-500/20',
            bg: 'bg-purple-500/10',
            tab: 'manifests' as const,
          },
          {
            label: 'Storage Capacity',
            value: `${storageGB.toFixed(2)} GB`,
            sub: `${((stats?.localBufferUsed || 0) / (1024 * 1024)).toFixed(1)} MB cache buffer`,
            icon: Database,
            color: 'text-amber-400',
            border: 'border-amber-500/20',
            bg: 'bg-amber-500/10',
            tab: 'settings' as const,
          },
          {
            label: 'Firewall Shields',
            value: totalFirewallBlocks.toLocaleString(),
            sub: 'Active blocks & bans',
            icon: ShieldAlert,
            color: 'text-rose-400',
            border: 'border-rose-500/20',
            bg: 'bg-rose-500/10',
            tab: 'firewall' as const,
          },
        ].map((stat, i) => (
          <div
            key={i}
            onClick={() => navigateFromChart(stat.tab)}
            className={`glass rounded-2xl p-5 border ${stat.border} hover:bg-white/10 transition-all group relative overflow-hidden flex flex-col justify-between cursor-pointer active:scale-98`}
          >
            <div
              className={`absolute -right-6 -top-6 w-24 h-24 ${stat.bg} rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity`}
            />
            <div className="flex items-start justify-between relative z-10 mb-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {stat.label}
              </p>
              <stat.icon className={`h-4 w-4 ${stat.color} opacity-80 group-hover:scale-110 transition-transform`} />
            </div>
            <div className="relative z-10">
              <p className="text-2xl font-black text-white tracking-tight flex items-center justify-between">
                <span>{stat.value}</span>
                <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white group-hover:translate-x-1 transition-all" />
              </p>
              <p className="text-[9px] font-medium text-muted-foreground uppercase mt-1 opacity-70 truncate">
                {stat.sub}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Admin Navigation Shortcuts */}
      <div className="glass rounded-2xl p-3.5 border border-white/5 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 ml-2">
          Shortcuts
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {[
            { label: 'AI Diagnostics', icon: Cpu, tab: 'diagnostics' as const, color: 'hover:border-indigo-500/40 hover:text-indigo-300 bg-indigo-500/10 border-indigo-500/20' },
            { label: 'Manifests', icon: Package, tab: 'manifests' as const, color: 'hover:border-purple-500/40 hover:text-purple-300' },
            { label: 'User Directory', icon: Users, tab: 'users' as const, color: 'hover:border-blue-500/40 hover:text-blue-300' },
            { label: 'Firewall', icon: ShieldAlert, tab: 'firewall' as const, color: 'hover:border-rose-500/40 hover:text-rose-300' },
            { label: 'API Keys', icon: Key, tab: 'keys' as const, color: 'hover:border-amber-500/40 hover:text-amber-300' },
            { label: 'Hosted Bots', icon: Bot, tab: 'hosted-bots' as const, color: 'hover:border-indigo-500/40 hover:text-indigo-300' },
            { label: 'System Logs', icon: FileText, tab: 'logs' as const, color: 'hover:border-emerald-500/40 hover:text-emerald-300' },
          ].map((sc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => navigateFromChart(sc.tab)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-bold text-white/80 transition-all active:scale-95 ${sc.color}`}
            >
              <sc.icon className="h-3.5 w-3.5 opacity-70" />
              <span>{sc.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Generation Nexus Analytics */}
      <div className="glass rounded-[2rem] p-6 border border-white/5 relative overflow-hidden flex flex-col justify-between">
        <div className="flex items-center justify-between mb-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-xl border border-purple-500/30">
              <Gamepad2 className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Gen Nexus Analytics
              </h3>
              <p className="text-[10px] text-muted-foreground font-medium">
                Web Application vs Discord Bot Request Ratio
              </p>
            </div>
          </div>
        </div>
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <GenerationAnalyticsChart
            webGens={stats?.webGens || 0}
            discordGens={stats?.discordGens || 0}
          />
        </div>
      </div>

      {/* Analytics Row 2: 4-Column Balanced Grid with Fluid Scaling */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        {/* Top Regions */}
        <div className="glass rounded-[2rem] p-5 border border-white/5 flex flex-col justify-between min-h-[340px]">
          <AdminBarChart
            title="Top Client Regions"
            items={(stats?.geoTraffic || []).map((g: any) => ({
              label: g.userCountry || 'Unknown',
              value: g._count?._all ?? 0,
            }))}
            barColor="#818cf8"
            onSelectCountry={() => navigateFromChart('logs')}
          />
        </div>

        {/* Registry Health */}
        <div className="glass rounded-[2rem] p-5 border border-white/5 flex flex-col justify-between min-h-[340px]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/80 mb-2">
            Registry Title Integrity
          </p>
          <div className="flex-1 flex flex-col justify-center">
            <ManifestHealthDonut
              total={stats?.manifests || 0}
              placeholderCount={stats?.placeholderManifestCount || 0}
              onNavigate={navigateFromChart}
            />
          </div>
        </div>

        {/* Subsystem Health Matrix */}
        <div className="glass rounded-[2rem] p-5 border border-emerald-500/20 bg-emerald-500/5 flex flex-col justify-between min-h-[340px]">
          {stats?.platformHealth?.nodes?.length ? (
            <PlatformHealthDiagram
              nodes={stats.platformHealth.nodes}
              healthy={stats.platformHealth.healthy}
              onNavigate={navigateFromChart}
              onRefresh={() => void refreshStats()}
              refreshing={statsRefreshing}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground py-8 space-y-2">
              <Activity className="h-6 w-6 opacity-30 animate-pulse" />
              <span>Evaluating platform subsystems...</span>
            </div>
          )}
        </div>

        {/* Verification Conversion Funnel */}
        <div className="glass rounded-[2rem] p-5 border border-violet-500/20 bg-violet-500/5 flex flex-col justify-between min-h-[340px]">
          {stats?.verifyFunnel ? (
            <VerifyFunnelChart
              counts={stats.verifyFunnel.counts || {}}
              completionRate={stats.verifyFunnel.completionRate || 0}
              failureRate={stats.verifyFunnel.failureRate || 0}
              sessionsByStatus={stats.verifyFunnel.sessionsByStatus}
              onNavigate={navigateFromChart}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-8">
              Loading verification funnel...
            </div>
          )}
        </div>
      </div>

      {/* Storage Capacity Telemetry */}
      <div className="glass rounded-[2rem] p-7 border border-white/5 relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-1000">
          <Database className="h-40 w-40 text-indigo-500" />
        </div>
        <div className="flex items-center justify-between mb-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-500/20 rounded-2xl border border-zinc-500/30">
              <Database className="h-6 w-6 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                Storage & Cache Infrastructure
              </h3>
              <p className="text-[10px] text-muted-foreground font-medium">
                Disk Storage Volume & Local Memory Buffer Capacity
              </p>
            </div>
          </div>
          <div
            className={`px-3.5 py-1.5 rounded-full text-[10px] font-bold uppercase border flex items-center gap-2 ${
              stats?.storageUsed > 0
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                stats?.storageUsed > 0 ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span>{stats?.storageUsed > 0 ? 'Disk Mounted' : 'Initializing'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10 mb-6">
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
              Main Library Storage
            </p>
            <p className="text-3xl font-black text-white font-mono">
              {storageGB.toFixed(2)}
              <span className="text-base ml-1 opacity-50 font-normal">GB</span>
            </p>
            <p className="text-[10px] text-muted-foreground uppercase font-medium">
              {stats?.storageManifests || 0} Synced Objects
            </p>
          </div>
          <div className="space-y-1.5 md:border-l md:border-white/5 md:pl-6">
            <p className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
              Transient Buffer Cache
            </p>
            <p className="text-3xl font-black text-white font-mono">
              {((stats?.localBufferUsed || 0) / (1024 * 1024)).toFixed(1)}
              <span className="text-base ml-1 opacity-50 font-normal">MB</span>
            </p>
            <p className="text-[10px] text-muted-foreground uppercase font-medium">
              Fast Local Cache Buffer
            </p>
          </div>
          <div className="space-y-1.5 md:border-l md:border-white/5 md:pl-6">
            <p className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
              Storage Availability SLA
            </p>
            <p className="text-3xl font-black text-white font-mono">
              99.9<span className="text-base ml-1 opacity-50 font-normal">%</span>
            </p>
            <p className="text-[10px] text-muted-foreground uppercase font-medium">
              Target Read/Write Availability
            </p>
          </div>
        </div>

        <div className="relative z-10">
          <StorageUsageBar storageUsedBytes={stats?.storageUsed || 0} />
        </div>
      </div>

      {/* Real-time API Activity Telemetry */}
      <div className="glass rounded-[2.5rem] p-7 border border-white/5 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/5 shadow-inner">
              <Activity className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider">
                API Traffic Telemetry
              </h3>
              <p className="text-[10px] text-muted-foreground font-medium">
                Live Traffic Stream ({filteredRecentUsage.length} matching logs)
              </p>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter endpoint, user, IP..."
                value={feedSearch}
                onChange={(e) => setFeedSearch(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl py-1.5 pl-9 pr-3 text-xs text-white placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 w-48 sm:w-60"
              />
            </div>

            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 text-[10px]">
              {['ALL', 'GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethodFilter(m)}
                  className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                    methodFilter === m
                      ? 'bg-indigo-500 text-white'
                      : 'text-muted-foreground hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => reloadTab('overview')}
              className="px-3.5 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-[10px] font-bold text-indigo-400 rounded-xl border border-indigo-500/20 transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {filteredRecentUsage.map((usage: any) => {
            const isSuccess = usage.status < 400
            const methodBg =
              usage.method === 'POST'
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                : usage.method === 'GET'
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                : usage.method === 'DELETE'
                ? 'bg-red-500/20 text-red-300 border-red-500/30'
                : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'

            return (
              <div
                key={usage.id}
                className="flex items-center justify-between p-3.5 bg-white/[0.02] hover:bg-white/5 border border-white/5 rounded-2xl transition-all group hover:border-white/10"
              >
                <div className="flex items-center space-x-3.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isSuccess
                        ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                        : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                    } group-hover:scale-125 transition-transform`}
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${methodBg}`}
                      >
                        {usage.method}
                      </span>
                      <span className="text-xs font-mono font-bold text-white tracking-tight">
                        {usage.endpoint}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-[9px] text-muted-foreground">
                      <span className="font-bold text-muted-foreground">
                        {usage.apiKey?.user?.username || 'System Client'}
                      </span>
                      <span>•</span>
                      <span className="font-mono">
                        {new Date(usage.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <span className="text-[10px] font-mono text-white/40 hidden sm:block bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                    {usage.ip}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border ${
                      isSuccess
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-red-500/10 text-red-500 border-red-500/20'
                    }`}
                  >
                    {usage.status}
                  </span>
                </div>
              </div>
            )
          })}

          {filteredRecentUsage.length === 0 && (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <Activity className="h-6 w-6 mx-auto opacity-20 animate-pulse" />
              <p className="italic text-xs font-medium opacity-60">
                No matching telemetry logs found
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
