'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { Search, Download, Gamepad, Key, CheckCircle, AlertCircle, Copy, Sparkles, LogOut, Loader2, ArrowRight, BarChart3, Zap, Shield, Book, Activity, Heart, Trophy, Star, Terminal, MessageSquare } from 'lucide-react'
import { useToast } from './components/Toast'
import { ReVerifyBanner } from './components/ReVerifyBanner'
import { formatRateLimitUserMessage } from './lib/rate-limit-client'
import { useSiteSettings } from './hooks/useSiteSettings'

// Basic Discord icon
const DiscordIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
)

interface SteamGame {
  name: string
  header_image: string
  short_description: string
  steam_appid: number
  genres?: { description: string }[]
  release_date?: { date: string }
}

interface ManifestResult {
  id: string
  appId: string
  name: string
  downloadUrl: string
  fileSize?: number
}

interface GenerationStats {
  todayCount: number
  dailyLimit: number
  plan: string
  recentGenerations: { id: string; appId: string; gameName: string; createdAt: string }[]
  apiQuotaRemaining?: number
  apiDailyLimitPerKey?: number
  hasEnabledApiKey?: boolean
}

export default function Home() {
  const { data: session, status } = useSession()
  const site = useSiteSettings()
  const [appId, setAppId] = useState('')
  const [gameInfo, setGameInfo] = useState<SteamGame | null>(null)
  const [loading, setLoading] = useState(false)
  const [manifestResult, setManifestResult] = useState<ManifestResult | null>(null)
  const { error: toastError, success: toastSuccess } = useToast()
  const [genStats, setGenStats] = useState<GenerationStats | null>(null)

  // Steam name → appId autocomplete
  const [suggestions, setSuggestions] = useState<{ id: number; name: string; image: string | null }[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      fetchGenStats()
    } else if (status === 'unauthenticated') {
      setGenStats(null)
    }
  }, [status])

  // Debounced search-by-name. Skips numeric input (those are appIds — fetched as-is).
  useEffect(() => {
    const trimmed = appId.trim()
    if (!trimmed || /^\d+$/.test(trimmed) || trimmed.length < 2) {
      setSuggestions([])
      setSuggestLoading(false)
      return
    }
    setSuggestLoading(true)
    const t = setTimeout(async () => {
      try {
        suggestionAbortRef.current?.abort()
        const ctrl = new AbortController()
        suggestionAbortRef.current = ctrl
        const res = await fetch(`/api/steam/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal })
        if (!res.ok) { setSuggestions([]); return }
        const data = await res.json()
        setSuggestions(Array.isArray(data.items) ? data.items : [])
      } catch {
        /* aborted or network — fine */
      } finally {
        setSuggestLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [appId])

  const fetchGenStats = async () => {
    try {
      const res = await fetch('/api/user/generations')
      if (res.ok) {
        const data = await res.json()
        setGenStats(data)
      }
    } catch (e) {
      console.error('Failed to fetch generation stats:', e)
    }
  }

  const searchGame = async (overrideAppId?: string) => {
    // Prefer the explicit override (e.g. from a suggestion click) over state,
    // since setAppId() is async and the closure would otherwise read the
    // previous text-input value and resolve back to the first search hit.
    const inputValue = (overrideAppId ?? appId).trim()
    if (!inputValue) return

    setLoading(true)
    setManifestResult(null)
    try {
      // Resolve free-text input to an appId via Steam search (skips for numeric input).
      let resolvedAppId = inputValue
      if (!/^\d+$/.test(resolvedAppId)) {
        const sRes = await fetch(`/api/steam/search?q=${encodeURIComponent(resolvedAppId)}`)
        const sData = await sRes.json().catch(() => ({ items: [] }))
        const first = Array.isArray(sData.items) && sData.items[0]
        if (!first?.id) {
          toastError('No match', `No Steam game found for "${resolvedAppId}".`)
          setGameInfo(null)
          return
        }
        resolvedAppId = String(first.id)
        setAppId(resolvedAppId)
      }

      const response = await fetch(`/api/steam/game/${resolvedAppId}`)
      if (response.ok) {
        const data = await response.json()
        setGameInfo(data)
      } else {
        const err = await response.json()
        toastError('Game not found', err.error || 'Try 730 for CS:GO.')
        setGameInfo(null)
      }
    } catch (err) {
      console.error('Error fetching game info:', err)
      toastError('Search Failed', 'Failed to fetch game info')
    } finally {
      setLoading(false)
    }
  }

  const generateManifest = async () => {
    if (!appId || !gameInfo) return
    
    setLoading(true)
    try {
      const tryPost = async (consumeApiQuota: boolean) => {
        const response = await fetch('/api/manifests/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: parseInt(appId, 10),
            gameInfo,
            ...(consumeApiQuota ? { consumeApiQuota: true } : {}),
          }),
        })
        const data = await response.json().catch(() => ({}))
        return { response, data }
      }

      let { response, data } = await tryPost(false)

      if (
        response.status === 429 &&
        (data.code === 'WEB_DAILY_QUOTA' || data.code === 'WEB_QUOTA_EXHAUSTED') &&
        typeof data.apiQuotaRemaining === 'number' &&
        data.apiQuotaRemaining > 0 &&
        data.hasApiKeys
      ) {
        const ok = window.confirm(
          `You have used all ${data.dailyWebLimit} web generations for today (UTC). Spend 1 successful API request from your remaining pool (${data.apiQuotaRemaining} left across your API keys) to generate this manifest anyway?`
        )
        if (ok) {
          const second = await tryPost(true)
          response = second.response
          data = second.data
        }
      }

      if (response.ok) {
        setManifestResult(data.manifest)
        toastSuccess('Manifest Generated', 'Successfully created game manifest!')
        fetchGenStats()
      } else {
        toastError(
          response.status === 429 ? 'Rate Limited' : 'Generation Failed',
          response.status === 429 ? formatRateLimitUserMessage(data) : (data.error || 'Failed to generate manifest')
        )
      }
    } catch (err) {
      console.error('Error generating manifest:', err)
      toastError('Error', 'Failed to generate manifest')
    } finally {
      setLoading(false)
    }
  }

  const usagePercent = genStats ? Math.min(100, (genStats.todayCount / Math.max(1, genStats.dailyLimit)) * 100) : 0
  const isAtLimit = genStats ? genStats.todayCount >= genStats.dailyLimit : false

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Background glow effects */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-amber-500/10 blur-[150px] pointer-events-none" />

      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <a href={site.siteUrl} className="flex items-center space-x-3 group" target="_blank" rel="noopener noreferrer">
            <div className="group-hover:scale-110 transition-transform">
              <img src={site.logoPath} alt={site.siteName} className="h-9 w-9 rounded-full ring-1 ring-cyan-400/30" />
            </div>
            <div className="flex flex-col -space-y-1">
              <span className="text-xl font-bold tracking-tight text-white hidden sm:block group-hover:text-cyan-300 transition-colors">{site.siteName}</span>
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-cyan-400 group-hover:text-amber-400 transition-colors flex items-center space-x-1">
                <div className="h-1 w-1 bg-current rounded-full animate-pulse" />
                <span>Live Status: OK</span>
              </span>
            </div>
          </a>

          <div className="flex items-center space-x-4">
            {status === 'loading' ? (
              <div className="h-10 w-32 bg-white/5 animate-pulse rounded-lg" />
            ) : session ? (
              <div className="flex items-center space-x-4">
                <div className="hidden md:flex items-center space-x-3 pr-4 border-r border-white/10">
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{session.user?.name}</p>
                    <p className="text-xs text-indigo-400">Authenticated user</p>
                  </div>
                  {session.user?.image ? (
                    <img src={session.user.image} alt="Avatar" className="w-10 h-10 rounded-full border border-white/10" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                      <span className="text-indigo-400 font-bold">{session.user?.name?.charAt(0)}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => window.location.href = '/dashboard'}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20"
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                </button>
                <button
                  onClick={() => window.location.href = '/docs'}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 transition-all"
                >
                  <Book className="h-4 w-4" />
                  <span className="hidden sm:inline">Docs</span>
                </button>

                <a
                  href="https://opensteam.mysellauth.com/"
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold text-purple-200 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-all"
                >
                  <span className="hidden sm:inline">Shop</span>
                </a>
                <button
                  onClick={() => window.location.href = '/pricing'}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold text-indigo-100 bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <span className="hidden sm:inline">Pricing</span>
                </button>
                <button
                  onClick={() => window.location.href = '/support'}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden sm:inline">Support</span>
                </button>
                <button
                  onClick={() => signOut()}
                  className="flex items-center space-x-2 p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn('discord', { callbackUrl: '/' })}
                className="group relative flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium shadow-lg shadow-[#5865F2]/20 transition-all overflow-hidden"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-500" />
                <DiscordIcon className="h-5 w-5" />
                <span>Log in with Discord</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Status Bar for logged-in users */}
      {session && genStats && (
        <div className="relative z-40 w-full">
          <div className="container mx-auto px-6">
            <div className="glass rounded-2xl mt-4 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4">
              
              {/* Usage Progress */}
              <div className="flex items-center space-x-4 flex-1 min-w-0">
                <div className={`p-2.5 rounded-xl ${isAtLimit ? 'bg-red-500/10 border border-red-500/20' : 'bg-indigo-500/10 border border-indigo-500/20'}`}>
                  <BarChart3 className={`h-5 w-5 ${isAtLimit ? 'text-red-400' : 'text-indigo-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-white">
                      Today&apos;s Generations
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${isAtLimit ? 'text-red-400' : 'text-indigo-400'}`}>
                      {genStats.todayCount} / {genStats.dailyLimit}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">
                    Web generations (dashboard) · resets UTC midnight
                    {genStats.hasEnabledApiKey &&
                    typeof genStats.apiQuotaRemaining === 'number' &&
                    typeof genStats.apiDailyLimitPerKey === 'number' ? (
                      <span className="block mt-1 text-indigo-200/80">
                        API pool: <span className="font-bold text-indigo-300 tabular-nums">{genStats.apiQuotaRemaining}</span> successes left today (sum across keys, {genStats.apiDailyLimitPerKey}/key cap)
                      </span>
                    ) : null}
                  </p>
                  <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        isAtLimit 
                          ? 'bg-gradient-to-r from-red-500 to-red-400' 
                          : usagePercent > 75 
                            ? 'bg-gradient-to-r from-amber-500 to-orange-400' 
                            : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Plan Badge & CTA */}
              <div className="flex items-center space-x-3 flex-shrink-0">
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                  {genStats.plan === 'FREE' ? (
                    <Shield className="h-3.5 w-3.5 text-gray-400" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 text-indigo-400" />
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    genStats.plan === 'FREE' ? 'text-gray-400' : 'text-indigo-400'
                  }`}>
                    {genStats.plan}
                  </span>
                </div>
                {genStats.plan === 'FREE' && (
                  <button
                    onClick={() => window.location.href = '/pricing'}
                    className="text-xs font-bold text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all flex items-center space-x-1"
                  >
                    <Zap className="h-3 w-3" />
                    <span>Upgrade</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-6 pb-24 relative z-10 flex flex-col items-center">
        <div className="w-full max-w-4xl mx-auto mt-8">
          <ReVerifyBanner />
          {site.publicAccessUrl ? (
            <div className="mt-4 glass border border-cyan-500/30 bg-cyan-500/10 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-300/80">Public link (share with everyone)</p>
                <p className="text-sm text-white/90 truncate mt-1 font-mono">{site.publicAccessUrl}</p>
                <p className="text-xs text-white/50 mt-1">opensteam.lol only works on your PC — others must use this link.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(site.publicAccessUrl || '')
                  toastSuccess('Copied!', 'Public link copied')
                }}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-semibold transition-colors"
              >
                <Copy className="h-4 w-4" />
                Copy link
              </button>
            </div>
          ) : null}
        </div>
        
        {/* Desktop App Banner */}
        <div className="w-full max-w-4xl mx-auto mt-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="glass rounded-[2rem] p-6 sm:p-8 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20 relative overflow-hidden group hover:border-indigo-500/40 transition-all duration-700">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[80px] pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-700" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 blur-[60px] pointer-events-none" />
            
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
              <div className="flex-1 space-y-4 text-center md:text-left">
                <div className="inline-flex items-center space-x-2 px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-indigo-300 text-[10px] font-black uppercase tracking-[0.2em]">
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span>New Release</span>
                </div>
                <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-amber-300">
                  {site.desktopAppTitle}
                </h3>
                <p className="text-indigo-200/80 text-sm sm:text-base leading-relaxed max-w-lg mx-auto md:mx-0">
                  Manage manifests natively from your PC. Fast, lightweight, and directly integrated with your hardware. Install via PowerShell in seconds.
                </p>
              </div>
              
              <div className="w-full md:w-auto flex flex-col space-y-3 shrink-0">
                <div className="flex items-center space-x-3 bg-[#0A0A0C]/80 border border-indigo-500/20 rounded-xl p-4 shadow-2xl relative group/code hover:border-indigo-500/40 transition-colors backdrop-blur-md">
                  <Terminal className="h-5 w-5 text-indigo-400 flex-shrink-0" />
                  <code className="text-sm font-mono text-indigo-300 whitespace-nowrap overflow-hidden text-ellipsis pr-12 w-[280px] sm:w-[320px]">
                     {site.desktopInstallCommand}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(site.desktopInstallCommand)
                      toastSuccess('Copied!', 'Command copied to clipboard')
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg transition-colors text-indigo-300 hover:text-white"
                    title="Copy command"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center md:justify-end space-x-2 text-[10px] text-white/40 uppercase tracking-widest font-semibold">
                  <div className="w-1 h-1 rounded-full bg-white/40" />
                  <span>Run in Windows PowerShell</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <div className="max-w-3xl w-full text-center mb-16 space-y-6 mt-10 animate-float">
          <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-indigo-300 mb-4 backdrop-blur-md">
            <Sparkles className="h-4 w-4" />
            <span>Generate games with the light of speed</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6">
            The Ultimate <br className="hidden md:block"/>
            <span className="text-gradient">{site.heroTitle}</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {site.heroSubtitle}
          </p>
        </div>

        {/* Action Center Container */}
        <div className="w-full max-w-4xl grid grid-cols-1 gap-8">
          
          {/* At-limit Warning */}
          {session && isAtLimit && (
            <div className="glass !bg-red-500/10 !border-red-500/20 text-red-200 p-5 rounded-2xl flex items-start space-x-4 animate-in fade-in slide-in-from-bottom-4">
              <AlertCircle className="h-6 w-6 flex-shrink-0 text-red-400 mt-0.5" />
              <div>
                <p className="font-semibold text-red-100 mb-1">Daily limit reached</p>
                <p className="text-sm text-red-300/80">
                  You&apos;ve used all {genStats?.dailyLimit} web generations for today.
                  {genStats &&
                  genStats.hasEnabledApiKey &&
                  typeof genStats.apiQuotaRemaining === 'number' &&
                  genStats.apiQuotaRemaining > 0 ? (
                    <>
                      {' '}
                      You can still generate by spending <strong className="text-red-100">1 API success</strong> from your pool ({genStats.apiQuotaRemaining} left) — click Generate and confirm.
                    </>
                  ) : genStats?.plan === 'FREE' ? (
                    <>
                      {' '}
                      <a href="/pricing" className="underline font-bold text-red-200 hover:text-white transition-colors">Upgrade</a> for higher web limits, create an API key in the Dashboard to trade API quota, or wait until UTC midnight.
                    </>
                  ) : (
                    <> Create an API key in the Dashboard to trade quota, or wait until UTC midnight.</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Search Card */}
          <div className="glass rounded-3xl p-2 flex flex-col sm:flex-row items-center relative z-20 shadow-2xl">
            <div className="flex-1 w-full pl-6 pr-4 py-4 sm:py-0 relative">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-400/50" />
              <input
                type="text"
                placeholder="Enter a Steam game name or App ID (e.g., Counter-Strike or 730)..."
                value={appId}
                onChange={(e) => {
                  setAppId(e.target.value)
                  setManifestResult(null)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onKeyDown={(e) => e.key === 'Enter' && searchGame()}
                className="w-full pl-10 pr-4 py-3 bg-transparent border-none focus:ring-0 text-white placeholder-white/30 text-lg outline-none"
              />
            </div>
            <button
              onClick={() => searchGame()}
              disabled={!appId || loading}
              className="w-full sm:w-auto mx-2 mb-2 sm:mb-0 px-8 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl text-white font-semibold flex items-center justify-center space-x-2 hover:opacity-90 disabled:opacity-50 transition-all group"
            >
              {loading && !gameInfo ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <span>Extract Data</span>
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            {/* Suggestions dropdown — name-based search via Steam's storesearch API.
                Positioned at the search-card level so it spans the full card width
                with the input + button as one cohesive unit. */}
            {showSuggestions && (suggestions.length > 0 || suggestLoading) && !/^\d+$/.test(appId.trim()) && (
              <div className="absolute top-full left-0 right-0 mt-3 glass rounded-3xl shadow-2xl overflow-hidden z-30 max-h-96 overflow-y-auto overscroll-contain custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-white/5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center space-x-1.5">
                    <Search className="h-3 w-3" />
                    <span>Steam Search</span>
                  </p>
                  {suggestLoading && (
                    <Loader2 className="h-3 w-3 animate-spin text-indigo-400/60" />
                  )}
                </div>
                {suggestLoading && suggestions.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-white/40 flex items-center space-x-2 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Searching Steam…</span>
                  </div>
                ) : (
                  <div className="p-2">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => {
                          // onMouseDown beats the input's onBlur, keeping the click registered.
                          // Pass the id explicitly to searchGame — setAppId() is async.
                          e.preventDefault()
                          const chosenId = String(s.id)
                          setAppId(chosenId)
                          setShowSuggestions(false)
                          setSuggestions([])
                          searchGame(chosenId)
                        }}
                        className="w-full flex items-center space-x-4 px-3 py-2.5 rounded-2xl hover:bg-indigo-500/10 hover:ring-1 hover:ring-indigo-500/20 transition-all text-left group"
                      >
                        {s.image ? (
                          // Steam's tiny_image is ~184x69 (capsule) — wide thumbnail keeps the full image visible.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.image} alt="" className="w-28 h-10 rounded-lg object-cover bg-zinc-800 shrink-0 ring-1 ring-white/5 group-hover:ring-indigo-500/30 transition-all" />
                        ) : (
                          <div className="w-28 h-10 rounded-lg bg-zinc-800 shrink-0 flex items-center justify-center ring-1 ring-white/5">
                            <Gamepad className="h-4 w-4 text-white/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate group-hover:text-indigo-200 transition-colors">{s.name}</p>
                          <p className="text-[10px] font-mono text-indigo-400/60 mt-0.5">App ID · {s.id}</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-white/20 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Result Card */}
          {gameInfo && (
            <div className="glass rounded-3xl p-8 animate-in fade-in slide-in-from-bottom-8 duration-500 shadow-2xl">
              <div className="flex flex-col md:flex-row gap-8 items-start">
                
                {/* Game Image */}
                <div className="w-full md:w-1/3 relative group rounded-2xl overflow-hidden shadow-2xl bg-black/50">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
                  <img
                    src={gameInfo.header_image}
                    alt={gameInfo.name}
                    className="w-full h-auto aspect-[460/215] object-cover rounded-2xl group-hover:scale-105 transition-duration-700"
                  />
                  <div className="absolute bottom-4 left-4 z-20">
                    <div className="text-xs font-bold px-2 py-1 rounded bg-black/60 text-white border border-white/10 uppercase tracking-wider backdrop-blur-md">
                      App ID: {gameInfo.steam_appid}
                    </div>
                  </div>
                </div>

                {/* Game Details */}
                <div className="flex-1 space-y-6 w-full">
                  <div>
                    <h2 className="text-3xl font-bold text-white mb-2 leading-tight">{gameInfo.name}</h2>
                    <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                      {gameInfo.short_description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {gameInfo.genres?.slice(0, 4).map((g) => (
                      <span key={g.description} className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-indigo-300">
                        {g.description}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-white/10 flex flex-wrap gap-4 items-center">
                    {!manifestResult ? (
                      <button
                        onClick={generateManifest}
                        disabled={loading || !session || isAtLimit}
                        className="flex-1 sm:flex-none px-6 py-3 rounded-xl font-medium flex items-center justify-center space-x-2 bg-white text-black hover:bg-gray-100 disabled:opacity-50 disabled:bg-white/10 disabled:text-white transition-all shadow-xl shadow-white/10"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Packaging...</span>
                          </>
                        ) : !session ? (
                          <>
                            <DiscordIcon className="h-5 w-5" />
                            <span>Sign in to Generate</span>
                          </>
                        ) : isAtLimit ? (
                          <>
                            <AlertCircle className="h-5 w-5" />
                            <span>Daily Limit Reached</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-5 w-5 text-indigo-600" />
                            <span>Extract Game Manifest</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="w-full space-y-4 animate-in fade-in zoom-in duration-500">
                        <div className="flex items-center space-x-3 text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 py-3 px-4 rounded-xl">
                          <CheckCircle className="h-5 w-5" />
                          <span className="font-medium text-sm">
                            Ready! Manifest compiled successfully.
                          </span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row gap-3">
                          <a
                            href={manifestResult.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 px-6 py-3 rounded-xl font-medium flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:opacity-90 shadow-xl shadow-emerald-500/20 transition-all"
                          >
                            <Download className="h-5 w-5" />
                            <span>Download ZIP Package</span>
                            {manifestResult.fileSize && (
                              <span className="text-emerald-100 text-sm ml-2 font-normal">
                                ({(manifestResult.fileSize / 1024).toFixed(1)} KB)
                              </span>
                            )}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Donation Promotion Card */}
        <div className="w-full max-w-4xl mt-24 mb-12">
           <div className="glass rounded-[2.5rem] p-8 md:p-12 border border-white/5 relative overflow-hidden group hover:border-indigo-500/20 transition-all duration-700 bg-[#0A0A0C]/40">
              <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 blur-[120px] pointer-events-none group-hover:bg-indigo-500/10 transition-all" />
              <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/5 blur-[100px] pointer-events-none" />
              
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
                 <div className="space-y-6 max-w-xl text-center md:text-left">
                    <div className="inline-flex items-center space-x-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[10px] font-black uppercase tracking-[0.2em]">
                       <Trophy className="h-3.5 w-3.5" />
                       <span>Community Rewards</span>
                    </div>
                    <h2 className="text-4xl font-black text-white italic tracking-tight">SUPPORT THE <span className="text-indigo-500">INFRASTRUCTURE</span></h2>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                       Donate your unused Steam keys to help fasten the Denuvo activations across the platform. As a token of our gratitude, contributors receive an exclusive <span className="text-white font-bold">Donator Role</span> and priority status.
                    </p>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4 pt-2">
                       <button 
                         onClick={() => window.location.href = '/donate'}
                         className="px-8 py-4 bg-white text-black rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-indigo-50 transition-all flex items-center space-x-2 shadow-xl shadow-white/5"
                       >
                          <Heart className="h-4 w-4 fill-black" />
                          <span>Donate Keys Now</span>
                       </button>
                    </div>
                 </div>
                 <div className="relative group-hover:scale-110 transition-transform duration-700">
                    <div className="p-8 bg-indigo-500/10 rounded-[3rem] border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
                       <Gamepad className="h-20 w-20 text-indigo-400 group-hover:rotate-12 transition-transform" />
                    </div>
                    <div className="absolute -top-4 -right-4 p-4 bg-amber-500 text-black rounded-3xl shadow-xl animate-bounce">
                       <Star className="h-6 w-6 fill-black" />
                    </div>
                 </div>
              </div>
           </div>
        </div>

        {/* Developer API Section */}
        <div className="w-full max-w-5xl mt-32 grid grid-cols-1 md:grid-cols-2 gap-12 items-center animate-in fade-in slide-in-from-bottom-12 duration-1000">
          <div className="space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-xs font-bold uppercase tracking-widest">
              API RESTRICTED V2
            </div>
            <h2 className="text-4xl font-extrabold text-white leading-tight">
              Developer-First <br/>
              <span className="text-indigo-400">Streamlined Integration</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Our restructured API makes it easier than ever to integrate manifest automation into your scripts, servers, and launchers. No more complex headers — just put your key in the URL and go.
            </p>
            <ul className="space-y-4">
              {[
                { icon: Zap, text: "Fast Generate via /api/{key}/generate/{id}", color: "text-amber-400" },
                { icon: Shield, text: "Smart Firewall with auto IP-jail protection", color: "text-emerald-400" },
                { icon: BarChart3, text: "Real-time usage monitoring and logs", color: "text-blue-400" }
              ].map((item, i) => (
                <li key={i} className="flex items-center space-x-3 text-white/80">
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                  <span className="font-medium">{item.text}</span>
                </li>
              ))}
            </ul>
            <div className="pt-4">
              <button 
                onClick={() => window.location.href = '/docs'}
                className="group flex items-center space-x-2 text-indigo-400 font-bold hover:text-indigo-300 transition-colors"
              >
                <span>Read Developer Documentation</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
          
          <div className="glass rounded-3xl p-6 border-white/5 bg-black/40 shadow-2xl relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent pointer-events-none" />
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-400/50" />
                <div className="w-3 h-3 rounded-full bg-amber-400/50" />
                <div className="w-3 h-3 rounded-full bg-emerald-400/50" />
              </div>
              <span className="text-[10px] font-mono text-white/30 truncate max-w-[150px]">GET /api/YOUR_KEY/generate/730</span>
            </div>
            <pre className="text-sm font-mono leading-relaxed text-indigo-300 overflow-x-auto whitespace-pre">
{`{
  "success": true,
  "generated": true,
  "manifest": {
    "appId": "730",
    "name": "CS:GO",
    "downloadUrl": "..."
  }
}`}
            </pre>
          </div>
        </div>

        {/* Call to Action Section */}
        <div className="w-full max-w-4xl mt-48 mb-24 space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
          <div className="text-center space-y-4 mb-10">
            <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight">Level up your integration.</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">Take full control of the API, manage rate limits, track usages, and request unsupported games natively from your personalized dashboard.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-gray-100 text-black rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all shadow-xl shadow-white/10"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => window.location.href = '/pricing'}
              className="w-full sm:w-auto px-8 py-4 bg-transparent border border-white/20 hover:bg-white/5 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <span>View Plans & Limits</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <footer className="w-full py-8 border-t border-white/5 mt-24">
          <div className="container mx-auto px-6 flex flex-col items-center justify-center space-y-4">
            <div className="flex items-center space-x-6 text-xs font-bold uppercase tracking-widest">
              <a href="/tos" className="text-muted-foreground hover:text-indigo-400 transition-colors">Terms</a>
              <a href="/privacy" className="text-muted-foreground hover:text-indigo-400 transition-colors">Privacy</a>
              <a href="/credits" className="text-muted-foreground hover:text-indigo-400 transition-colors">Credits</a>
              <a href="/support" className="text-emerald-400 hover:text-emerald-300 transition-colors font-bold">Support</a>
              <a href="/incidents" className="text-red-400 hover:text-red-300 transition-colors font-bold">Incidents</a>
              <a href="/donate" className="text-amber-400 hover:text-amber-300 transition-colors">Donate</a>
              <a href={site.discordInvite} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-[#5865F2] transition-colors">Discord</a>
              <a href={site.telegramLink} target="_blank" rel="noopener noreferrer" className="text-[#0088cc] hover:text-[#00aaee] transition-colors font-bold">Telegram</a>
            </div>
            <div className="flex flex-col items-center space-y-2">
              <div className="flex items-center space-x-2 text-white/40 text-sm font-medium">
                <img src={site.logoPath} alt={site.siteName} className="w-5 h-5 rounded-full opacity-80" />
                <span>{site.footerText}</span>
              </div>
              <p className="text-[10px] text-white/20 uppercase tracking-[0.2em]">{site.tagline}</p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
