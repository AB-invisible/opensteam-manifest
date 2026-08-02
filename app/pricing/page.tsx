'use client'

import React, { useState, useEffect } from 'react'
import { Check, X, Sparkles, Gamepad2, ArrowRight, Building2, RefreshCw, ShieldCheck, BarChart3, Package, Globe, Zap, Clock, Bot, FileArchive } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PandabaseCheckoutEmbed } from "@/app/components/PandabaseCheckout"
import { useSession } from "next-auth/react"
import { PLAN_CONFIG } from '@/app/lib/config'

type PricingUsageSnapshot = {
  webUsed: number
  webLimit: number
  apiUsedToday: number
  apiLimitPerKey: number
  apiPoolRemaining: number | null
  hasApiKeys: boolean
}

export default function PricingPage() {
  const router = useRouter()
  const { data: session, status, update: updateSession } = useSession()
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null)
  const [checkoutStoreId, setCheckoutStoreId] = useState<string | null>(null)
  const [checkoutPlanName, setCheckoutPlanName] = useState<string | null>(null)
  /** undefined = loading (when authed), null = guest or failed fetch */
  const [liveUsage, setLiveUsage] = useState<PricingUsageSnapshot | null | undefined>(undefined)
  
  const user = session?.user as any
  const currentPlan = user?.plan || 'FREE'
  const isStaff = user?.role === 'ADMIN' || user?.role === 'MODERATOR' || user?.role === 'OWNER'

  const n = (v: number) => v.toLocaleString()

  useEffect(() => {
    if (status !== 'authenticated') {
      setLiveUsage(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLiveUsage(undefined)
      try {
        const [gRes, uRes] = await Promise.all([
          fetch('/api/user/generations'),
          fetch('/api/user/usage'),
        ])
        if (cancelled) return
        if (!gRes.ok || !uRes.ok) {
          setLiveUsage(null)
          return
        }
        const g = await gRes.json()
        const u = await uRes.json()
        setLiveUsage({
          webUsed: g.todayCount ?? 0,
          webLimit: g.dailyLimit ?? PLAN_CONFIG.FREE.webDaily,
          apiUsedToday: u.todayRequests ?? 0,
          apiLimitPerKey: g.apiDailyLimitPerKey ?? u.apiDailyLimit ?? PLAN_CONFIG.FREE.apiDaily,
          apiPoolRemaining: typeof g.apiQuotaRemaining === 'number' ? g.apiQuotaRemaining : null,
          hasApiKeys: !!g.hasEnabledApiKey,
        })
      } catch {
        if (!cancelled) setLiveUsage(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  const handleAction = () => {
    router.push('/dashboard')
  }

  const handleBuy = async (planName: string) => {
    if (currentPlan === planName) return
    setLoadingPlan(planName)
    try {
      const res = await fetch('/api/pandabase/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName }),
      })
      const data = await res.json()
      if (res.ok && data.sessionId && data.storeId) {
        setCheckoutPlanName(planName)
        setCheckoutStoreId(data.storeId)
        setCheckoutSessionId(data.sessionId)
      } else {
        alert(data.error || "Failed to initiate checkout")
      }
    } catch (err) {
      console.error(err)
      alert("Error initiating checkout")
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30 overflow-hidden">
      {checkoutSessionId && checkoutStoreId && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in"
          onClick={() => { setCheckoutSessionId(null); setCheckoutStoreId(null); }}
        >
          <div 
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#0c0c0e] rounded-[2rem] border border-white/5 shadow-2xl ring-1 ring-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Area */}
            <div className="flex justify-between items-center p-6 pb-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h3 className="text-white font-bold text-lg">Complete Checkout</h3>
              </div>
              <button
                onClick={() => { setCheckoutSessionId(null); setCheckoutStoreId(null); }}
                className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {/* Embed Area */}
            <div className="w-full">
              <PandabaseCheckoutEmbed
                storeId={checkoutStoreId}
                sessionId={checkoutSessionId}
                theme="dark"
                returnUrl={
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/dashboard?tab=${
                        checkoutPlanName === 'REGULAR' || checkoutPlanName === 'PREMIUM'
                          ? 'bot-branded'
                          : checkoutPlanName === 'RESELLER' || checkoutPlanName === 'BUSINESS'
                            ? 'bot-custom'
                            : 'overview'
                      }`
                    : 'http://127.0.0.1:3000/dashboard'
                }
                onComplete={async (orderId) => {
                  console.log("Paid:", orderId)
                  setCheckoutSessionId(null);
                  setCheckoutStoreId(null);
                  
                  await updateSession();
                  
                  const tab =
                    checkoutPlanName === 'REGULAR' || checkoutPlanName === 'PREMIUM'
                      ? 'bot-branded'
                      : checkoutPlanName === 'RESELLER' || checkoutPlanName === 'BUSINESS'
                        ? 'bot-custom'
                        : 'overview'
                  setCheckoutPlanName(null)
                  router.push(`/dashboard?tab=${tab}`)
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

      {/* Navbar (Mini) */}
      <nav className="relative z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/favicon.ico" alt="OpenSteam" className="h-7 w-7" />
            </div>
            <span className="text-xl font-bold text-white hidden sm:block">OpenSteam</span>
          </div>
          <button onClick={() => router.push('/')} className="text-sm font-medium text-white/70 hover:text-white transition-colors flex items-center group">
            <span>Back to Generator</span>
            <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-20 relative z-10 flex flex-col items-center">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-6 animate-float">
          <div className="flex items-center justify-center space-x-3 mb-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-sm font-semibold text-indigo-300 backdrop-blur-md">
              <Sparkles className="h-4 w-4" />
              <span>Developer Pricing</span>
            </div>
            {isStaff && (
              <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-[10px] font-black uppercase tracking-widest text-purple-400 backdrop-blur-md">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Staff Access</span>
              </div>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-purple-200">
              Plans built around gens.
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            One gen = one Steam App ID manifest bundle. Pick a tier for daily web, API, and Discord bot limits.
          </p>
        </div>

        <div className="w-full max-w-4xl mb-10 relative animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="absolute -inset-px rounded-[1.75rem] bg-gradient-to-br from-indigo-500/30 via-purple-500/10 to-emerald-500/20 blur-sm opacity-70" />
          <div className="relative glass rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 md:p-8 space-y-6 text-left overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
                <Package className="h-6 w-6 text-indigo-300" />
              </div>
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-indigo-300 mb-2">What is a gen?</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  A <strong className="text-white/90">gen</strong> resolves one Steam App ID into a downloadable package — a{' '}
                  <strong className="text-white/90">ZIP with manifest and cover art</strong>, ready for your launcher, site, or bot.
                  Cached titles still count as one gen when you download them.
                </p>
              </div>
            </div>

            <div className="relative flex flex-wrap items-center justify-center gap-2 py-2 text-[11px] font-semibold text-white/50">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <Globe className="h-3.5 w-3.5 text-indigo-400" /> App ID
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-white/25 hidden sm:block" />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-200">
                <FileArchive className="h-3.5 w-3.5" /> Manifest ZIP
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-white/25 hidden sm:block" />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-200">
                <Check className="h-3.5 w-3.5" /> Ready to use
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
              <div className="rounded-xl bg-black/30 border border-indigo-500/15 p-4 hover:border-indigo-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-indigo-400" />
                  <p className="font-bold text-white">Web gens</p>
                </div>
                <p className="text-muted-foreground leading-snug">
                  Site generator on opensteam.lol. Same daily pool as Discord <code className="text-indigo-300 bg-indigo-500/10 px-1 rounded">/gen</code>.
                </p>
              </div>
              <div className="rounded-xl bg-black/30 border border-emerald-500/15 p-4 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-emerald-400" />
                  <p className="font-bold text-white">API successes</p>
                </div>
                <p className="text-muted-foreground leading-snug">
                  Successful programmatic manifest responses. Each API key has its own daily cap and burst limit.
                </p>
              </div>
              <div className="rounded-xl bg-black/30 border border-amber-500/15 p-4 hover:border-amber-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <p className="font-bold text-white">Resets</p>
                </div>
                <p className="text-muted-foreground leading-snug">
                  All daily quotas reset at <strong className="text-white/80">UTC midnight</strong>. Out of web gens? Spend one API success on the site when prompted.
                </p>
              </div>
            </div>
          </div>
        </div>

        {status === 'authenticated' && (
          <div className="w-full max-w-xl mb-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {liveUsage === undefined ? (
              <div className="glass rounded-2xl border border-white/10 p-6 h-[140px] bg-white/[0.02] animate-pulse" />
            ) : liveUsage ? (
              <div className="glass rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/[0.08] to-purple-500/[0.04] p-6 space-y-5 shadow-xl shadow-indigo-500/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 border border-indigo-500/30">
                    <BarChart3 className="h-5 w-5 text-indigo-400 shrink-0" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-indigo-300">Your plan usage today</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      <span className="font-bold text-white/80">{currentPlan}</span>
                      {' · '}
                      UTC day · includes custom overrides
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-black/35 border border-white/10 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Web gens today</p>
                      <Globe className="h-3.5 w-3.5 text-indigo-400/70" />
                    </div>
                    <p className="text-2xl font-black text-white tabular-nums">
                      {n(liveUsage.webUsed)} <span className="text-white/35 text-lg font-bold">/</span> {n(liveUsage.webLimit)}
                    </p>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-400 transition-all duration-500"
                        style={{ width: `${Math.min(100, (liveUsage.webUsed / Math.max(1, liveUsage.webLimit)) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Site + Discord /gen · resets UTC midnight</p>
                  </div>
                  <div className="rounded-xl bg-black/35 border border-white/10 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">API successes</p>
                      <Zap className="h-3.5 w-3.5 text-emerald-400/70" />
                    </div>
                    <p className="text-2xl font-black text-white tabular-nums">{n(liveUsage.apiUsedToday)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Today across all keys · <span className="text-emerald-300/90">{n(liveUsage.apiLimitPerKey)}</span>/key/day cap
                    </p>
                    {liveUsage.hasApiKeys && liveUsage.apiPoolRemaining !== null ? (
                      <p className="text-[10px] text-indigo-300/90 font-semibold px-2 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                        Pool remaining: {n(liveUsage.apiPoolRemaining)}
                      </p>
                    ) : (
                      <p className="text-[10px] text-amber-400/80 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        No enabled API key — create one in the dashboard.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">Could not load your usage. Try refreshing or open the dashboard.</p>
            )}
          </div>
        )}

        {/* Billing badges */}
        <div className="flex items-center gap-6 mb-14 flex-wrap justify-center text-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-semibold">
            <Check className="h-4 w-4" />
            <span>Free, Regular, Premium &amp; Reseller — One-Time Payment</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 font-semibold">
            <RefreshCw className="h-4 w-4" />
            <span>Large Business — Monthly Subscription</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 w-full max-w-[90rem]">
          {/* FREE */}
          <div className={`glass rounded-3xl p-6 border transition-all flex flex-col relative ${currentPlan === 'FREE' ? 'border-emerald-500/50 bg-emerald-500/5' : 'hover:border-white/20'}`}>
            {currentPlan === 'FREE' && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full">Current Plan</div>}
            <h3 className="text-lg font-bold text-white mb-2">Free</h3>
            <p className="text-xs text-muted-foreground min-h-[40px]">Try the web generator and API with upstream fetch when a title is not cached.</p>
            <div className="my-4">
              <span className="text-3xl font-extrabold text-white">$0</span>
              <span className="text-muted-foreground text-xs"> one-time</span>
            </div>
            <QuotaPills web={PLAN_CONFIG.FREE.webDaily} api={PLAN_CONFIG.FREE.apiDaily} burst={PLAN_CONFIG.FREE.apiBurst} accent="emerald" />
            <ul className="space-y-2.5 mb-6 flex-1 text-[13px] text-gray-300">
              <PlanSectionDivider label="Daily limits" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.FREE.webDaily)}</strong> web gens / day — site + shared quota</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.FREE.apiDaily)}</strong> API successes / day / key</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" /> <span>Burst <strong>{n(PLAN_CONFIG.FREE.apiBurst)}</strong> req / 5s / key</span></li>
              <PlanSectionDivider label="Each gen includes" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Manifest ZIP (JSON + cover art)</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Web UI generator + developer API keys</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Upstream fetch (Ryuu + Morrenus fallback) when not cached</li>
            </ul>
            <button onClick={handleAction} className={`w-full py-2.5 px-4 rounded-xl border font-semibold text-sm transition-all ${currentPlan === 'FREE' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-white/10 text-white hover:bg-white/5'}`}>
              {currentPlan === 'FREE' ? 'Current Plan' : 'Get Started'}
            </button>
          </div>

          {/* REGULAR */}
          <div className={`glass rounded-3xl p-6 border transition-all flex flex-col relative transform hover:-translate-y-1 duration-300 ${currentPlan === 'REGULAR' ? 'border-indigo-500 bg-indigo-500/5' : 'hover:border-indigo-500/50 border-white/10'}`}>
            <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">One-Time</div>
            {currentPlan === 'REGULAR' && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full">Current Plan</div>}
            <h3 className="text-lg font-bold text-white mb-2">Regular</h3>
            <p className="text-xs text-muted-foreground min-h-[40px]">Higher gen limits plus a branded Discord bot on your server.</p>
            <div className="my-4 flex items-baseline">
              <span className="text-3xl font-extrabold text-white">$2</span>
              <span className="text-muted-foreground ml-2 text-xs">one-time</span>
            </div>
            <QuotaPills web={PLAN_CONFIG.REGULAR.webDaily} api={PLAN_CONFIG.REGULAR.apiDaily} burst={PLAN_CONFIG.REGULAR.apiBurst} accent="indigo" />
            <ul className="space-y-2.5 mb-6 flex-1 text-[13px] text-gray-300">
              <PlanSectionDivider label="Daily limits" />
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.REGULAR.webDaily)}</strong> web gens / day — site + Discord <code className="text-indigo-300">/gen</code></span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.REGULAR.apiDaily)}</strong> API successes / day / key</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0 mt-0.5" /> <span>Burst <strong>{n(PLAN_CONFIG.REGULAR.apiBurst)}</strong> req / 5s / key</span></li>
              <PlanSectionDivider label="Also includes" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" /> Manifest ZIP per gen (JSON + cover art)</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" /> API keys + game request submissions</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0 mt-0.5" /> <span className="inline-flex items-start gap-1.5 flex-wrap"><Bot className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" /><span><strong>Branded bot</strong> — shared OpenSteam bot: <code className="text-indigo-300 bg-indigo-500/10 px-1 rounded text-[11px]">/gen</code> <code className="text-indigo-300 bg-indigo-500/10 px-1 rounded text-[11px]">/request</code> <code className="text-indigo-300 bg-indigo-500/10 px-1 rounded text-[11px]">/status</code></span></span></li>
            </ul>
            <button onClick={() => handleBuy('REGULAR')} disabled={loadingPlan === 'REGULAR' || currentPlan === 'REGULAR'} className={`w-full py-2.5 px-4 rounded-xl transition-all font-semibold text-sm flex items-center justify-center ${currentPlan === 'REGULAR' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50'}`}>
              {loadingPlan === 'REGULAR' ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {currentPlan === 'REGULAR' ? 'Current Plan' : (loadingPlan === 'REGULAR' ? 'Processing...' : 'Buy Now')}
            </button>
          </div>

          {/* PREMIUM */}
          <div className={`glass rounded-3xl p-6 border-2 transition-all flex flex-col relative transform lg:-translate-y-2 shadow-2xl ${currentPlan === 'PREMIUM' ? 'border-indigo-400 bg-indigo-500/10 shadow-indigo-500/20' : 'border-indigo-500 bg-indigo-500/5 shadow-indigo-500/10'}`}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full">{currentPlan === 'PREMIUM' ? 'Current Plan' : 'Most Popular'}</div>
            <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">One-Time</div>
            <h3 className="text-lg font-bold text-white mb-2">Premium</h3>
            <p className="text-xs text-indigo-200/70 min-h-[40px]">5× Regular web gens, faster API burst, analytics, and branded Discord bot.</p>
            <div className="my-4">
              <span className="text-3xl font-extrabold text-white">$4</span>
              <span className="text-muted-foreground text-xs ml-2">one-time</span>
            </div>
            <QuotaPills web={PLAN_CONFIG.PREMIUM.webDaily} api={PLAN_CONFIG.PREMIUM.apiDaily} burst={PLAN_CONFIG.PREMIUM.apiBurst} accent="indigo" />
            <ul className="space-y-2.5 mb-6 flex-1 text-[13px] text-gray-100">
              <PlanSectionDivider label="Daily limits" />
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.PREMIUM.webDaily)}</strong> web gens / day — site + Discord <code className="text-indigo-300">/gen</code></span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.PREMIUM.apiDaily)}</strong> API successes / day / key</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0 mt-0.5" /> <span>Burst <strong>{n(PLAN_CONFIG.PREMIUM.apiBurst)}</strong> req / 5s / key</span></li>
              <PlanSectionDivider label="Also includes" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Everything in Regular, plus priority game requests</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Usage analytics in dashboard</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-indigo-400 mr-2 flex-shrink-0" /> <span><strong>Branded bot</strong> — shared OpenSteam bot: <code className="text-indigo-300">/gen</code>, <code className="text-indigo-300">/request</code>, <code className="text-indigo-300">/status</code></span></li>
            </ul>
            <button onClick={() => handleBuy('PREMIUM')} disabled={loadingPlan === 'PREMIUM' || currentPlan === 'PREMIUM'} className={`w-full py-2.5 px-4 rounded-xl transition-all font-bold text-sm flex items-center justify-center ${currentPlan === 'PREMIUM' ? 'bg-white/10 text-white border border-white/20' : 'bg-white text-indigo-900 hover:bg-gray-100 shadow-xl shadow-white/10 disabled:opacity-50'}`}>
              {loadingPlan === 'PREMIUM' ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {currentPlan === 'PREMIUM' ? 'Current Plan' : (loadingPlan === 'PREMIUM' ? 'Processing...' : 'Buy Now')}
            </button>
          </div>

          {/* RESELLER */}
          <div className={`glass rounded-3xl p-6 border transition-all flex flex-col relative transform hover:-translate-y-1 duration-300 ${currentPlan === 'RESELLER' ? 'border-amber-500 bg-amber-500/5' : 'hover:border-amber-500/40 border-white/10'}`}>
            <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">One-Time</div>
            {currentPlan === 'RESELLER' && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full">Current Plan</div>}
            <h3 className="text-lg font-bold mb-2 text-amber-400 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Reseller
            </h3>
            <p className="text-xs text-muted-foreground min-h-[40px]">Reseller API volume plus your own Discord app, hosted by OpenSteam.</p>
            <div className="my-4">
              <span className="text-3xl font-extrabold text-white">$6</span>
              <span className="text-muted-foreground text-xs ml-2">one-time</span>
            </div>
            <QuotaPills web={PLAN_CONFIG.RESELLER.webDaily} api={PLAN_CONFIG.RESELLER.apiDaily} burst={PLAN_CONFIG.RESELLER.apiBurst} accent="amber" />
            <ul className="space-y-2.5 mb-6 flex-1 text-[13px] text-gray-300">
              <PlanSectionDivider label="Daily limits" />
              <li className="flex items-start"><Check className="h-4 w-4 text-amber-500 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.RESELLER.webDaily)}</strong> web gens / day — site + Discord <code className="text-amber-300">/gen</code></span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.RESELLER.apiDaily)}</strong> API successes / day / key</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" /> <span>Burst <strong>{n(PLAN_CONFIG.RESELLER.apiBurst)}</strong> req / 5s / key</span></li>
              <PlanSectionDivider label="Also includes" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Reseller API endpoints + priority support</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-amber-500 mr-2 flex-shrink-0" /> <span><strong>Custom bot</strong> — your Discord app, we host: <code className="text-amber-300">/gen</code>, <code className="text-amber-300">/request</code>, <code className="text-amber-300">/link</code></span></li>
            </ul>
            <button onClick={() => handleBuy('RESELLER')} disabled={loadingPlan === 'RESELLER' || currentPlan === 'RESELLER'} className={`w-full py-2.5 px-4 rounded-xl border transition-all font-semibold text-sm flex items-center justify-center ${currentPlan === 'RESELLER' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'border-amber-500/50 hover:bg-amber-500/10 text-amber-400 disabled:opacity-50'}`}>
              {loadingPlan === 'RESELLER' ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {currentPlan === 'RESELLER' ? 'Current Plan' : (loadingPlan === 'RESELLER' ? 'Processing...' : 'Buy Now')}
            </button>
          </div>

          {/* LARGE BUSINESS */}
          <div className={`glass rounded-3xl p-6 border transition-all flex flex-col relative transform hover:-translate-y-1 duration-300 ${currentPlan === 'BUSINESS' ? 'border-purple-500 bg-purple-500/5' : 'hover:border-purple-500/40 border-white/10'}`}>
            <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full flex items-center gap-1">
              <RefreshCw className="h-2 w-2" /> Monthly
            </div>
            {currentPlan === 'BUSINESS' && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full">Current Plan</div>}
            <h3 className="text-lg font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
              Large Business
            </h3>
            <p className="text-xs text-muted-foreground min-h-[40px]">100k API gens/day, 3k web gens, custom hosted bot — billed monthly.</p>
            <div className="my-4">
              <span className="text-3xl font-extrabold text-white">$12</span>
              <span className="text-muted-foreground text-xs"> / month</span>
            </div>
            <QuotaPills web={PLAN_CONFIG.BUSINESS.webDaily} api={PLAN_CONFIG.BUSINESS.apiDaily} burst={PLAN_CONFIG.BUSINESS.apiBurst} accent="purple" />
            <ul className="space-y-2.5 mb-6 flex-1 text-[13px] text-gray-300">
              <PlanSectionDivider label="Daily limits" />
              <li className="flex items-start"><Sparkles className="h-4 w-4 text-purple-500 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.BUSINESS.webDaily)}</strong> web gens / day — site + Discord <code className="text-purple-300">/gen</code></span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> <span><strong>{n(PLAN_CONFIG.BUSINESS.apiDaily)}</strong> API successes / day / key</span></li>
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" /> <span>Burst <strong>{n(PLAN_CONFIG.BUSINESS.apiBurst)}</strong> req / 5s / key</span></li>
              <PlanSectionDivider label="Also includes" />
              <li className="flex items-start"><Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" /> Dedicated API pipeline + 24/7 priority support</li>
              <li className="flex items-start"><Check className="h-4 w-4 text-purple-500 mr-2 flex-shrink-0" /> <span><strong>Custom bot</strong> — your Discord app, we host (active subscription required)</span></li>
            </ul>
            <button onClick={() => handleBuy('BUSINESS')} disabled={loadingPlan === 'BUSINESS' || currentPlan === 'BUSINESS'} className={`w-full py-2.5 px-4 rounded-xl border transition-all font-semibold text-sm flex items-center justify-center ${currentPlan === 'BUSINESS' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : 'border-purple-500/50 hover:bg-purple-500/10 text-purple-400 disabled:opacity-50'}`}>
              {loadingPlan === 'BUSINESS' ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {currentPlan === 'BUSINESS' ? 'Current Plan' : (loadingPlan === 'BUSINESS' ? 'Processing...' : 'Subscribe Now')}
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground max-w-3xl mx-auto mt-8 leading-relaxed px-2">
          <span className="inline-block glass rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
            <strong className="text-white/70 block mb-1.5 text-xs uppercase tracking-wider">Quick reference</strong>
            Web gens cover the site generator and Discord{' '}
            <code className="text-indigo-300/90 bg-indigo-500/10 px-1 rounded">/gen</code> on your linked server (one shared daily pool per account).
            API successes are separate — counted only on successful manifest API responses, per key.
            Paid tiers above Free serve cached manifests by default; upstream fetch may require an admin override.
            Limits reset UTC midnight.
          </span>
        </p>

        {/* Voucher Workshop (Redemption) */}
        <div className="w-full max-w-4xl mt-16">
          <div className="glass rounded-[2.5rem] p-8 md:p-12 border border-amber-500/20 bg-amber-500/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-700">
              <Sparkles className="h-32 w-32 text-amber-500" />
            </div>
            
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 md:gap-16">
              <div className="flex-1 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-amber-500/20 rounded-2xl border border-amber-500/30">
                    <Gamepad2 className="h-6 w-6 text-amber-400" />
                  </div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-widest">Voucher Workshop</h2>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Have a distribution code? Redeem it here to instantly upgrade your account quota and unlock professional features.
                </p>
              </div>

              <div className="w-full md:w-[400px]">
                <VoucherRedeemer onRedeemed={() => router.push('/dashboard')} />
                <p className="text-[10px] text-amber-500/60 font-bold uppercase tracking-widest mt-4 text-center">
                  Codes are case-sensitive and single-use only.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="w-full py-8 border-t border-white/5 mt-12 flex flex-col items-center space-y-4">
          <div className="flex items-center space-x-6 text-[10px] font-black uppercase tracking-widest">
            <a href="/tos" className="text-muted-foreground hover:text-indigo-400 transition-colors">Terms of Service</a>
            <a href="/privacy" className="text-muted-foreground hover:text-indigo-400 transition-colors">Privacy Policy</a>
            <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-[#5865F2] transition-colors">Discord Support</a>
          </div>
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="flex items-center space-x-2 text-white/40 text-sm font-medium">
              <img src="/favicon.ico" alt="OpenSteam" className="w-5 h-5 opacity-40 grayscale" />
              <span>© 2026 OpenSteam Platform. Powered by OpenSteam | Manifests</span>
            </div>
            <p className="text-[10px] text-white/20 uppercase tracking-[0.2em]">Secure • Scalable • Developer-First</p>
          </div>
        </footer>
      </main>
    </div>
  )
}

function PlanSectionDivider({ label }: { label: string }) {
  return (
    <li className="list-none pt-2 pb-1">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35 shrink-0">{label}</span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
      </div>
    </li>
  )
}

function QuotaPills({
  web,
  api,
  burst,
  accent = 'indigo',
}: {
  web: number
  api: number
  burst: number
  accent?: 'emerald' | 'indigo' | 'amber' | 'purple'
}) {
  const styles = {
    emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200',
    indigo: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-200',
    amber: 'bg-amber-500/10 border-amber-500/25 text-amber-200',
    purple: 'bg-purple-500/10 border-purple-500/25 text-purple-200',
  }
  const fmt = (v: number) => v.toLocaleString()
  const cls = styles[accent]
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${cls}`}>{fmt(web)} web/day</span>
      <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${cls}`}>{fmt(api)} API/day</span>
      <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${cls}`}>{fmt(burst)} burst</span>
    </div>
  )
}

function VoucherRedeemer({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success', msg: string } | null>(null)

  const redeem = async () => {
    if (!code) return
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/user/vouchers/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const data = await res.json()
      if (res.ok) {
        setStatus({ type: 'success', msg: data.message })
        setTimeout(onRedeemed, 2000)
      } else {
        setStatus({ type: 'error', msg: data.error })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-3">
        <input
          value={code} onChange={e => setCode(e.target.value)}
          placeholder="GG-XXXX-XXXX-XXXX"
          className="flex-1 bg-black/60 border border-white/10 rounded-2xl px-5 py-4 text-sm font-mono text-white outline-none focus:border-amber-500/50 transition-all uppercase placeholder:text-white/10 shadow-inner"
        />
        <button
          onClick={redeem} disabled={loading || !code}
          className="px-8 py-4 bg-amber-500 hover:bg-amber-400 text-black text-xs font-black rounded-2xl transition-all disabled:opacity-50 shadow-xl shadow-amber-500/20 active:scale-95 flex items-center space-x-2"
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <span>ACTIVATE</span>}
        </button>
      </div>
      {status && (
        <div className={`text-[10px] font-black uppercase tracking-widest text-center py-2 rounded-lg border animate-in fade-in zoom-in-95 ${
          status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
