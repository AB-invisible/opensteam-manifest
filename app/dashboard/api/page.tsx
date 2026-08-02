'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Activity, ArrowLeft, Globe, Monitor, Clock, 
  ChevronLeft, ChevronRight, Search, AlertCircle, Shield,
  Wifi, BarChart3, CheckCircle, XCircle, Zap, Server, Eye
} from 'lucide-react'
import { useToast } from '../../components/Toast'
import { ApiUsageTimeSeriesPanel, type ApiUsageChartsData } from '../../components/ApiUsageTimeSeriesPanel'
import { isModeratorPlus } from '@/app/lib/staff-roles'

interface ApiLog {
  id: string
  endpoint: string
  method: string
  status: number
  ip: string | null
  userAgent: string | null
  requestedAppId: string | null
  requestedName: string | null
  createdAt: string
  apiKey: {
    name: string
    key: string
  }
}

interface LogsResponse {
  logs: ApiLog[]
  total: number
  page: number
  limit: number
  totalPages: number
  summary: {
    totalRequests: number
    uniqueIPs: number
    uniqueUserAgents: number
    successRate: number
    todayRequests: number
  }
  charts?: ApiUsageChartsData
  limitsExplainer?: {
    velocity: string
    dailyQuota: string
  }
}

export default function ApiDashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [data, setData] = useState<LogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const { error: toastError } = useToast()
  const [page, setPage] = useState(1)
  const [searchFilter, setSearchFilter] = useState('')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/')
    } else if (status === 'authenticated' && session?.user) {
      const user = session.user as { role?: string }
      if (!isModeratorPlus(user.role)) {
        router.push('/dashboard')
      }
    }
  }, [status, session, router])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchLogs()
    }
  }, [status, page])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/user/api-logs?page=${page}&limit=25`)
      if (res.ok) {
        const d = await res.json()
        setData(d)
      } else {
        const err = await res.json()
        toastError('Failed to load logs', err.error || 'Failed to load API logs')
      }
    } catch (e) {
      toastError('Fetch Error', 'Failed to fetch API logs')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    if (statusCode >= 300 && statusCode < 400) return 'text-blue-400 bg-blue-400/10 border-blue-400/20'
    if (statusCode >= 400 && statusCode < 500) return 'text-amber-400 bg-amber-400/10 border-amber-400/20'
    return 'text-red-400 bg-red-400/10 border-red-400/20'
  }

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-emerald-400 bg-emerald-400/10'
      case 'POST': return 'text-blue-400 bg-blue-400/10'
      case 'PUT': return 'text-amber-400 bg-amber-400/10'
      case 'DELETE': return 'text-red-400 bg-red-400/10'
      default: return 'text-gray-400 bg-gray-400/10'
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const parseUserAgent = (ua: string | null) => {
    if (!ua || ua === 'unknown') return { browser: 'Unknown', os: 'Unknown', short: 'Unknown' }
    
    let browser = 'Unknown'
    let os = 'Unknown'

    // OS
    if (ua.includes('Windows')) os = 'Windows'
    else if (ua.includes('Mac')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

    // Browser / Client
    if (ua.includes('curl')) browser = 'cURL'
    else if (ua.includes('python-requests')) browser = 'Python'
    else if (ua.includes('axios')) browser = 'Axios'
    else if (ua.includes('node-fetch') || ua.includes('Node.js')) browser = 'Node.js'
    else if (ua.includes('Postman')) browser = 'Postman'
    else if (ua.includes('Firefox')) browser = 'Firefox'
    else if (ua.includes('Chrome')) browser = 'Chrome'
    else if (ua.includes('Safari')) browser = 'Safari'
    else if (ua.includes('Edge')) browser = 'Edge'

    return { browser, os, short: `${browser} / ${os}` }
  }

  const filteredLogs = data?.logs.filter(log => {
    if (!searchFilter) return true
    const q = searchFilter.toLowerCase()
    return (
      log.endpoint.toLowerCase().includes(q) ||
      log.ip?.toLowerCase().includes(q) ||
      log.requestedAppId?.toLowerCase().includes(q) ||
      log.requestedName?.toLowerCase().includes(q) ||
      log.apiKey.name.toLowerCase().includes(q) ||
      log.method.toLowerCase().includes(q) ||
      String(log.status).includes(q)
    )
  }) || []

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Activity className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[30%] h-[30%] rounded-full bg-purple-500/8 blur-[100px] pointer-events-none" />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/favicon.ico" alt="OpenSteam" className="h-7 w-7" />
            </div>
            <span className="text-xl font-bold text-white hidden sm:block">OpenSteam</span>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => router.push('/dashboard')} 
              className="flex items-center space-x-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-10 relative z-10 space-y-8">
        
        {/* Header */}
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight flex items-center space-x-3">
            <Server className="h-8 w-8 text-indigo-400" />
            <span>API Dashboard</span>
          </h1>
          <p className="text-muted-foreground text-lg">Monitor API key usage, track requests, and analyze traffic patterns.</p>
        </div>



        {/* Limits explainer: velocity vs daily */}
        {data?.limitsExplainer && (
          <div className="grid md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4">
            <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 to-transparent p-5 space-y-2">
              <div className="flex items-center gap-2 text-indigo-300">
                <Zap className="h-5 w-5" />
                <span className="text-xs font-black uppercase tracking-widest">Rate limiting (burst / minute / hour)</span>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">{data.limitsExplainer.velocity}</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300">
                <Globe className="h-5 w-5" />
                <span className="text-xs font-black uppercase tracking-widest">Daily usage (plan quota)</span>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">{data.limitsExplainer.dailyQuota}</p>
            </div>
          </div>
        )}

        {data?.charts &&
          (data.charts.daily.length > 0 || data.charts.weekly.length > 0 || data.charts.monthly.length > 0) && (
            <ApiUsageTimeSeriesPanel charts={data.charts} title="Usage over time" />
          )}

        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-in fade-in slide-in-from-bottom-4">
            <SummaryCard 
              icon={<BarChart3 className="h-5 w-5" />} 
              label="Total Requests" 
              value={String(data?.summary?.totalRequests)} 
              color="indigo"
            />
            <SummaryCard 
              icon={<Zap className="h-5 w-5" />} 
              label="Today" 
              value={String(data?.summary?.todayRequests)} 
              color="purple"
            />
            <SummaryCard 
              icon={<Wifi className="h-5 w-5" />} 
              label="Unique IPs" 
              value={String(data?.summary?.uniqueIPs)} 
              color="cyan"
            />
            <SummaryCard 
              icon={<Monitor className="h-5 w-5" />} 
              label="User Agents" 
              value={String(data?.summary?.uniqueUserAgents)} 
              color="amber"
            />
            <SummaryCard 
              icon={<CheckCircle className="h-5 w-5" />} 
              label="Success Rate" 
              value={`${data?.summary?.successRate}%`} 
              color="emerald"
            />
          </div>
        )}

        {/* Logs Table */}
        <div className="glass rounded-3xl p-6 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-8">
          
          {/* Table Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Activity className="h-5 w-5 text-indigo-400" />
                <span>Request Logs</span>
                {data && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({data.total} total)
                  </span>
                )}
              </h2>
              
              {/* Search */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input 
                  type="text"
                  placeholder="Filter logs..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                />
              </div>
            </div>

            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <Activity className="h-6 w-6 text-indigo-500 animate-spin" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-16 bg-white/5 border border-white/5 rounded-2xl border-dashed">
                <Server className="h-10 w-10 text-white/10 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm mb-1">No API logs found</p>
                <p className="text-muted-foreground/60 text-xs">Logs will appear here once you start making API requests.</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <th className="pb-3 pl-4">Time</th>
                        <th className="pb-3">Method</th>
                        <th className="pb-3">Endpoint</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">IP Address</th>
                        <th className="pb-3">Client</th>
                        <th className="pb-3">Requested</th>
                        <th className="pb-3">Key</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredLogs.map((log) => {
                        const ua = parseUserAgent(log.userAgent)
                        return (
                          <tr key={log.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="py-3.5 pl-4">
                              <div className="text-xs text-white/70">{formatDate(log.createdAt)}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{formatTime(log.createdAt)}</div>
                            </td>
                            <td className="py-3.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getMethodColor(log.method)}`}>
                                {log.method}
                              </span>
                            </td>
                            <td className="py-3.5 max-w-[200px]">
                              <span className="text-xs font-mono text-indigo-200 truncate block">{log.endpoint}</span>
                            </td>
                            <td className="py-3.5">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getStatusColor(log.status)}`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="py-3.5">
                              <span className="text-xs font-mono text-white/60">{log.ip || '—'}</span>
                            </td>
                            <td className="py-3.5">
                              <span className="text-xs text-white/60" title={log.userAgent || undefined}>
                                {ua.short}
                              </span>
                            </td>
                            <td className="py-3.5">
                              {log.requestedAppId ? (
                                <div>
                                  <span className="text-xs text-white/80 font-medium">{log.requestedName || '—'}</span>
                                  <span className="text-[10px] text-muted-foreground ml-1">({log.requestedAppId})</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-3.5">
                              <span className="text-[10px] font-mono text-purple-300/70 truncate block max-w-[100px]">
                                {log.apiKey.name}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                  {filteredLogs.map((log) => {
                    const ua = parseUserAgent(log.userAgent)
                    const isExpanded = expandedLog === log.id
                    

                    return (
                      <div
                        key={log.id}
                        className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3"
                      >
                        {/* Header Row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getMethodColor(log.method)}`}>
                              {log.method}
                            </span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getStatusColor(log.status)}`}>
                              {log.status}
                            </span>
                          </div>
                          <button
                            onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                            className="p-1 text-muted-foreground hover:text-white transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="text-xs font-mono text-indigo-200 truncate">{log.endpoint}</div>

                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>{formatDate(log.createdAt)} {formatTime(log.createdAt)}</span>
                          </span>
                          <span className="font-mono">{log.ip || '—'}</span>
                        </div>

                        {isExpanded && (
                          <div className="pt-3 border-t border-white/10 space-y-2 animate-in fade-in">
                            <DetailRow label="User Agent" value={log.userAgent || '—'} mono />
                            <DetailRow label="Client" value={ua.short} />
                            <DetailRow label="API Key" value={log.apiKey.name} />
                            {log.requestedAppId && (
                              <DetailRow 
                                label="Requested" 
                                value={`${log.requestedName || 'Unknown'} (${log.requestedAppId})`} 
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-white/10">
                    <span className="text-sm text-muted-foreground">
                      Page {data.page} of {data.totalPages}
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page <= 1}
                        className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Prev</span>
                      </button>
                      <button
                        onClick={() => setPage(Math.min(data.totalPages, page + 1))}
                        disabled={page >= data.totalPages}
                        className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        
      </main>
      <footer className="w-full py-8 border-t border-white/5 mt-12 flex flex-col items-center space-y-4">
        <div className="flex items-center space-x-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <a href="/tos" className="hover:text-indigo-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</a>
          <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="hover:text-[#5865F2] transition-colors">Discord Support</a>
        </div>
        <div className="flex items-center space-x-2 text-white/20 text-[10px] font-medium uppercase tracking-[0.2em]">
          <span>© 2026 OpenSteam Internal • Powered by API Console</span>
        </div>
      </footer>
    </div>
  )
}

// ---- Sub-components ----

function SummaryCard({ 
  icon, label, value, color 
}: { 
  icon: React.ReactNode; label: string; value: string; color: string 
}) {
  const colorMap: Record<string, string> = {
    indigo: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/20 text-indigo-400',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20 text-purple-400',
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20 text-cyan-400',
    amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/20 text-amber-400',
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
  }
  const cls = colorMap[color] || colorMap.indigo

  return (
    <div className={`p-5 rounded-2xl border bg-gradient-to-br ${cls} relative overflow-hidden group`}>
      <div className="absolute top-2 right-2 opacity-10 group-hover:opacity-20 transition-opacity">
        {icon}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-white tracking-tight">{value}</p>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xs text-white/80 ${mono ? 'font-mono break-all' : ''}`}>{value}</span>
    </div>
  )
}
