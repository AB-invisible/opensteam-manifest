'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Key, Activity, Gamepad2, AlertCircle, Copy, CheckCircle, Send, Clock,
  Trash2, Server, LogOut, BarChart3, Download, Sparkles, ArrowRight,
  Shield, Zap, TrendingUp, Globe, RefreshCw, Package, ChevronRight,
  Plus, Eye, EyeOff, Wifi, ShieldAlert, KeyRound, Heart,
  Star, Code, Layout, Play, Users, UserPlus, ShieldCheck,
  Search, ChevronDown, BookOpen, FileText, Gavel, Mail, MessageSquare,
  Link, MousePointer2, DollarSign, Bot, ShoppingCart
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────
import { useToast } from '../components/Toast'
import { ReVerifyBanner } from '../components/ReVerifyBanner'
import { AntiPhishingModal } from '../components/AntiPhishingModal'
import ModAttemptsTable from '@/app/components/admin/ModAttemptsTable'
import PromoTestCard from '@/app/components/promo-test/PromoTestCard'
import ExecutiveTestCard from '@/app/components/executive-test/ExecutiveTestCard'
import PromoTenureControls from '@/app/components/admin/PromoTenureControls'
import TrialModControls from '@/app/components/admin/TrialModControls'
import { ApiUsageTimeSeriesPanel, type ApiUsageChartsData } from '@/app/components/ApiUsageTimeSeriesPanel'
import { getBrowserFingerprint } from '@/app/lib/client-sentinel'
import { getDiscordCdnAvatarUrl, getDiscordAvatarErrorFallbacks } from '@/app/lib/discord-avatar'
import { TRIAL_MOD_DAYS } from '@/app/lib/moderator-trial'
import { isModeratorPlus } from '@/app/lib/staff-roles'
import BrandedBotTab from '@/app/dashboard/components/BrandedBotTab'
import CustomBotTab from '@/app/dashboard/components/CustomBotTab'
import HostedBotOverviewCard from '@/app/dashboard/components/HostedBotOverviewCard'
import MembersShopPanel from '@/app/admin/components/MembersShopPanel'

type Tab = 'overview' | 'keys' | 'requests' | 'database' | 'webhooks' | 'forge' | 'team' | 'reseller' | 'donations' | 'guides' | 'tests' | 'punishments' | 'settings' | 'bot-branded' | 'bot-custom' | 'members-shop'

const DASHBOARD_POLL_MS = 20_000

interface UserData {
  user: {
    id: string
    discordId: string
    username: string
    avatar: string | null
    email: string | null
    role: string
    plan: string
    planExpiry: string | null
    planIsCanceled: boolean
    createdAt: string
    fingerprint: string | null
    hasUpstreamAutoGen?: boolean
    discordGuildRestricted?: boolean
  }
  apiKeys: ApiKeyData[]
  recentManifests: ManifestData[]
}

interface ApiKeyData {
  id: string
  key: string
  name: string
  rateLimit: number
  rateWindow: number
  enabled: boolean
  createdAt: string
  lastUsed: string | null
  _count?: { usage: number }
}

interface ManifestData {
  id: string
  steamAppId: string
  name: string
  downloads: number
  createdAt: string
}

interface UsageStats {
  totalRequests: number
  todayRequests: number
  endpointUsage: Record<string, number>
  apiDailyLimit: number
  apiMinuteLimit: number
  charts?: ApiUsageChartsData
}

interface GenStats {
  todayCount: number
  dailyLimit: number
  plan: string
  recentGenerations: { id: string; appId: string; gameName: string; createdAt: string; isNsfw?: boolean }[]
  charts?: ApiUsageChartsData
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────
const PLAN_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  FREE: { label: 'Free', color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
  REGULAR: { label: 'Regular', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  PREMIUM: { label: 'Premium', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  RESELLER: { label: 'Reseller', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  BUSINESS: { label: 'Business', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
  CUSTOM: { label: 'Custom', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
}

function PlanBadge({ plan, role }: { plan: string; role?: string }) {
  if (role === 'OWNER') {
    return (
      <span className="inline-flex items-center space-x-1 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-red-500/10 border-red-500/30 text-red-400">
        <ShieldAlert className="h-3 w-3" />
        <span>Owner</span>
      </span>
    )
  }
  const m = PLAN_META[plan] || PLAN_META.FREE
  return (
    <span className={`inline-flex items-center space-x-1 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${m.bg} ${m.border} ${m.color}`}>
      {plan === 'FREE' ? <Shield className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
      <span>{m.label}</span>
    </span>
  )
}

function HostedBotPlanGate({ requiredPlan, tabLabel }: { requiredPlan: string; tabLabel: string }) {
  return (
    <div className="glass rounded-2xl p-8 border border-white/10 text-center space-y-3 animate-in fade-in">
      <Bot className="h-10 w-10 text-indigo-400 mx-auto" />
      <h2 className="text-lg font-bold text-white">{tabLabel}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        This feature requires a {requiredPlan} subscription. Upgrade your plan on the pricing page to unlock hosted Discord bots.
      </p>
      <a
        href="/pricing"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold"
      >
        View plans <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [userData, setUserData] = useState<UserData | null>(null)
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [genStats, setGenStats] = useState<GenStats | null>(null)

  const loadAll = useCallback(async () => {
    const fingerprint = getBrowserFingerprint()
    const [meRes, usageRes, genRes] = await Promise.all([
      fetch(`/api/auth/me?fp=${encodeURIComponent(fingerprint)}`),
      fetch('/api/user/usage'),
      fetch('/api/user/generations'),
    ])

    if (meRes.status === 401) {
      try {
        const errJson = await meRes.json()
        if (errJson.reason === 'inactivity') {
          signOut({ callbackUrl: '/?logout=inactivity' })
          return
        }
        if (errJson.reason === 'guild_left') {
          signOut({ callbackUrl: '/?logout=guild_left' })
          return
        }
        if (errJson.reason === 'guild_banned') {
          signOut({ callbackUrl: '/?logout=guild_banned' })
          return
        }
        if (errJson.reason === 'oauth_expired') {
          signOut({ callbackUrl: '/?logout=oauth_expired' })
          return
        }
      } catch {
        // fall through
      }
    }

    if (meRes.status === 403) {
      try {
        const errJson = await meRes.json()
        const discordId = errJson.discordId || (session?.user as any)?.discordId || ''
        router.push(`/banned?id=${discordId}`)
        return
      } catch {
        const discordId = (session?.user as any)?.discordId || ''
        router.push(`/banned?id=${discordId}`)
        return
      }
    }

    if (meRes.ok) setUserData(await meRes.json())
    if (usageRes.ok) setUsageStats(await usageRes.json())
    if (genRes.ok) setGenStats(await genRes.json())
  }, [router, session])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
    if (status === 'authenticated') loadAll()
  }, [status, router, loadAll])

  /** Live refresh: usage, manifests, keys snapshot — no full page reload. */
  useEffect(() => {
    if (status !== 'authenticated') return
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void loadAll()
    }
    const id = window.setInterval(refresh, DASHBOARD_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadAll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [status, loadAll])

  const tabMountRef = useRef(true)
  useEffect(() => {
    if (status !== 'authenticated') return
    if (tabMountRef.current) {
      tabMountRef.current = false
      return
    }
    void loadAll()
  }, [activeTab, status, loadAll])

  useEffect(() => {
    if (!userData || typeof window === 'undefined') return
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'bot-branded' || tab === 'bot-custom' || tab === 'members-shop') {
      setActiveTab(tab as Tab)
      return
    }
    const staffRoles = ['TRIAL_MODERATOR', 'MODERATOR', 'ADMIN', 'OWNER']
    if (!staffRoles.includes(userData.user.role)) return
    if (tab === 'guides' || tab === 'tests') {
      setActiveTab(tab as Tab)
    }
  }, [userData])

  if (status === 'loading' || !userData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Activity className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  const { user, apiKeys, recentManifests } = userData
  const navAvatarUrl = getDiscordCdnAvatarUrl(user.discordId, user.avatar, 72)
  const plan = user.plan
  const isPremiumPlus = ['PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM'].includes(plan)
  const isApiEnabled = true // All plans now have basic API access

  const navigateTab = (tab: Tab) => {
    setActiveTab(tab)
    if (typeof window === 'undefined') return
    const path = tab === 'overview' ? '/dashboard' : `/dashboard?tab=${tab}`
    router.replace(path, { scroll: false })
  }

  const sidebarItems: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'overview', icon: <BarChart3 className="h-5 w-5" />, label: 'Overview' },
    { id: 'keys', icon: <Key className="h-5 w-5" />, label: 'API Keys' },
    { id: 'requests', icon: <Gamepad2 className="h-5 w-5" />, label: 'Game Requests' },
    { id: 'members-shop', icon: <ShoppingCart className="h-5 w-5" />, label: 'Members Shop' },
    { id: 'donations', icon: <Star className="h-5 w-5" />, label: 'Donations' },
  ]

  // Forge (Scripts): REGULAR+ or Staff
  if (plan !== 'FREE' || user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') {
    sidebarItems.push({ id: 'forge', icon: <Sparkles className="h-5 w-5" />, label: 'Scripts' })
  }

  // Team
  sidebarItems.push({ id: 'team', icon: <Users className="h-5 w-5" />, label: 'Team' })

  // Webhooks: PREMIUM+ or Staff
  if (isPremiumPlus || user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') {
    sidebarItems.push({ id: 'webhooks', icon: <Globe className="h-5 w-5" />, label: 'Webhooks' })
  }

  // Reseller
  sidebarItems.push({ id: 'reseller', icon: <Package className="h-5 w-5" />, label: 'Reseller' })

  // Hosted Discord Bot
  if (['REGULAR', 'PREMIUM'].includes(plan) || user.role === 'OWNER') {
    sidebarItems.push({ id: 'bot-branded', icon: <Bot className="h-5 w-5" />, label: 'Branded Bot' })
  }
  if (['RESELLER', 'BUSINESS'].includes(plan)) {
    sidebarItems.push({ id: 'bot-custom', icon: <Bot className="h-5 w-5" />, label: 'Custom Bot' })
  }


  // Admin DB: ADMIN & OWNER
  if (user.role === 'ADMIN' || user.role === 'OWNER') {
    sidebarItems.push({ id: 'database', icon: <Server className="h-5 w-5" />, label: 'DB' })
  }

  // Guides: Moderator+ only
  if (user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') {
    sidebarItems.push({ id: 'guides', icon: <BookOpen className="h-5 w-5" />, label: 'Guides' })
  }

  // Tests & Punishments: All staff can see
  if (
    user.role === 'TRIAL_MODERATOR' ||
    user.role === 'MODERATOR' ||
    user.role === 'SENIOR_MODERATOR' ||
    user.role === 'HEAD_MODERATOR' ||
    user.role === 'ADMIN' ||
    user.role === 'OWNER'
  ) {
    sidebarItems.push({ id: 'tests', icon: <FileText className="h-5 w-5" />, label: 'Tests' })
    sidebarItems.push({ id: 'punishments', icon: <Gavel className="h-5 w-5" />, label: 'Punishments' })
  }

  // Always append Settings at the bottom
  sidebarItems.push({ id: 'settings', icon: <Layout className="h-5 w-5" />, label: 'Settings' })

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30">
      <AntiPhishingModal />
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[35%] h-[35%] rounded-full bg-purple-500/8 blur-[100px] pointer-events-none" />

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/opensteam.png" alt="OpenSteam" className="h-8 w-8 rounded-full object-contain ring-1 ring-cyan-400/30" />
            </div>
            <span className="text-lg font-bold text-white hidden sm:block">OpenSteam</span>
          </div>

          <div className="flex items-center space-x-3">
            <PlanBadge plan={plan} role={user.role} />
            {navAvatarUrl ? (
              <img
                src={navAvatarUrl}
                alt="Avatar"
                className="w-9 h-9 rounded-full border border-white/10"
                data-avatar-refresh-tried="0"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement
                  const tried = Number(img.getAttribute('data-avatar-refresh-tried') || '0')
                  const fallbacks = getDiscordAvatarErrorFallbacks(user.discordId, img.src, 72)
                  const next = fallbacks[tried]
                  if (next) {
                    img.setAttribute('data-avatar-refresh-tried', String(tried + 1))
                    img.src = `${next}${next.includes('?') ? '&' : '?'}cb=${Date.now()}`
                    return
                  }
                  img.style.display = 'none'
                }}
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <span className="text-indigo-400 font-bold text-sm">{user.username.charAt(0)}</span>
              </div>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 sm:px-6 pb-24 pt-8 relative z-10">
        {user.discordGuildRestricted && (
          <div className="mb-6 w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <strong className="font-semibold text-red-300">Discord ban active.</strong>{' '}
            You can browse the dashboard, but manifest generation, API keys, and game requests are disabled until your Discord ban is lifted.
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-8">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-full md:w-56 shrink-0 space-y-1">
          {/* User card */}
          <div className="glass rounded-2xl p-4 mb-4">
            <p className="text-sm font-semibold text-white truncate">{user.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email || 'No email'}</p>
            <div className="mt-2.5">
              <PlanBadge plan={user.plan} role={user.role} />
            </div>
            {(user.role === 'ADMIN' || user.role === 'MODERATOR' || user.role === 'TRIAL_MODERATOR' || user.role === 'OWNER') && (
              <p className={`text-[10px] font-black uppercase tracking-[0.15em] mt-3 flex items-center space-x-1.5 ${user.role === 'ADMIN' || user.role === 'OWNER' ? 'text-red-400' : 'text-purple-400'}`}>
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>{user.role === 'OWNER' ? 'Owner' : user.role === 'ADMIN' ? 'Administrator' : user.role === 'TRIAL_MODERATOR' ? 'Trial Moderator' : 'Moderator'}</span>
              </p>
            )}
          </div>

          {sidebarItems.map(item => (
            <button
              key={item.id}
              onClick={() => navigateTab(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all font-medium text-sm ${activeTab === item.id
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                : 'text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent'
                }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}

          {/* API Dashboard — Moderator+ only */}
          {(user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && (
            <button
              onClick={() => router.push('/dashboard/api')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all font-medium text-sm text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent group"
            >
              <Server className="h-5 w-5 group-hover:text-indigo-400 transition-colors" />
              <span>API Logs</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-500/20">
                Staff
              </span>
            </button>
          )}

          {/* Admin Panel — Role ADMIN & OWNER only */}
          {(user.role === 'ADMIN' || user.role === 'OWNER') && (
            <button
              onClick={() => router.push('/admin')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all font-medium text-sm text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent group"
            >
              <ShieldAlert className="h-5 w-5 group-hover:text-red-400 transition-colors" />
              <span>Admin Panel</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full border border-red-500/20">
                {user.role === 'OWNER' ? 'Owner' : 'Admin'}
              </span>
            </button>
          )}

          {/* Moderation Bot — Role ADMIN & OWNER only */}
          {(user.role === 'ADMIN' || user.role === 'OWNER') && (
            <button
              onClick={() => router.push('/dashboard/moderation')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all font-medium text-sm text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent group"
            >
              <MessageSquare className="h-5 w-5 group-hover:text-indigo-400 transition-colors" />
              <span>Moderation Bot</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-500/20">
                AI
              </span>
            </button>
          )}

          <div className="pt-3">
            <button
              onClick={() => router.push('/')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 border border-transparent transition-all"
            >
              <Package className="h-5 w-5" />
              <span>Generator</span>
              <ChevronRight className="h-4 w-4 ml-auto" />
            </button>
            <button
              onClick={() => router.push('/pricing')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 border border-transparent transition-all"
            >
              <TrendingUp className="h-5 w-5" />
              <span>Upgrade Plan</span>
              <ChevronRight className="h-4 w-4 ml-auto" />
            </button>
          </div>
        </aside>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">
          {activeTab === 'overview' && (
            <OverviewTab
              user={user}
              usageStats={usageStats}
              genStats={genStats}
              recentManifests={recentManifests}
              apiKeys={apiKeys}
              hasUpstreamAutoGen={user.hasUpstreamAutoGen ?? false}
              isApiEnabled={isApiEnabled}
              onNavigate={(tab: Tab) => navigateTab(tab)}
            />
          )}
          {activeTab === 'keys' && (
            <ApiKeysTab
              plan={plan}
              initialKeys={apiKeys}
              isApiEnabled={isApiEnabled}
            />
          )}
          {activeTab === 'requests' && <GameRequestsTab />}
          {activeTab === 'members-shop' && (
            <MembersShopPanel variant="member" toastSuccess={toastSuccess} toastError={toastError} />
          )}
          {activeTab === 'webhooks' && (isPremiumPlus || user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && <WebhooksTab />}
          {activeTab === 'forge' && <ForgeTab user={user} />}
          {activeTab === 'team' && <TeamTab />}
          {activeTab === 'reseller' && <ResellerTab />}
          {activeTab === 'bot-branded' && (
            ['REGULAR', 'PREMIUM'].includes(plan) ? (
              <BrandedBotTab />
            ) : (
              <HostedBotPlanGate requiredPlan="REGULAR or PREMIUM" tabLabel="Branded Bot" />
            )
          )}
          {activeTab === 'bot-custom' && (
            ['RESELLER', 'BUSINESS'].includes(plan) ? (
              <CustomBotTab />
            ) : (
              <HostedBotPlanGate requiredPlan="RESELLER or BUSINESS" tabLabel="Custom Bot" />
            )
          )}
          {activeTab === 'database' && (user.role === 'ADMIN' || user.role === 'OWNER') && <DatabaseTab />}
          {activeTab === 'donations' && <DonationsTab />}
          {activeTab === 'guides' && (user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && <GuidesTab />}
          {activeTab === 'tests' && (user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'SENIOR_MODERATOR' || user.role === 'HEAD_MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && <TestsTab userRole={user.role} />}
          {activeTab === 'punishments' && (user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && <PunishmentsTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
        </div>
      </div>
      <footer className="w-full py-8 border-t border-white/5 mt-12 flex flex-col items-center space-y-4">
        <div className="flex items-center space-x-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <a href="/tos" className="hover:text-indigo-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</a>
          <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="hover:text-[#5865F2] transition-colors">Community Support</a>
        </div>
        <div className="flex items-center space-x-2 text-white/20 text-[10px] font-medium uppercase tracking-[0.2em]">
          <span>© 2026 OpenSteam Internal • Powered by OpenSteam</span>
        </div>
      </footer>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  user, usageStats, genStats, recentManifests, apiKeys, hasUpstreamAutoGen, isApiEnabled, onNavigate
}: {
  user: UserData['user']
  usageStats: UsageStats | null
  genStats: GenStats | null
  recentManifests: ManifestData[]
  apiKeys: ApiKeyData[]
  hasUpstreamAutoGen: boolean
  isApiEnabled: boolean
  onNavigate: (tab: Tab) => void
}) {
  const [seenWelcome, setSeenWelcome] = useState(true)
  const router = useRouter()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSeenWelcome(localStorage.getItem('gamegen_seen_welcome') === 'true')
    }
  }, [])

  const webUsedPct = genStats ? Math.min(100, (genStats.todayCount / genStats.dailyLimit) * 100) : 0
  const totalApiReqs = usageStats?.totalRequests ?? 0
  const daysLeft = user.planExpiry ? Math.ceil((new Date(user.planExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
  const showStaffCharts = isModeratorPlus(user.role)

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <ReVerifyBanner />
      {/* Interactive Welcome Onboarding Tour Banner */}
      {!seenWelcome && (
        <div className="glass !border-indigo-500/30 bg-indigo-500/5 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-indigo-950/20 animate-in slide-in-from-top-2 duration-500">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-bold text-white flex items-center gap-1.5">
                New to OpenSteam? Take the Tour!
                <span className="text-[9px] font-extrabold uppercase tracking-widest bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded animate-pulse">
                  Quick Guide
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Take our 1-minute step-by-step interactive onboarding walkthrough to learn what OpenSteam is, how the dashboard limits operate, how Sentinel protection works, and how to utilize programmatic developer APIs!
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push('/welcome')}
            className="w-full sm:w-auto shrink-0 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all uppercase tracking-wider shadow-lg shadow-indigo-950/40"
          >
            <span>Start Guide Tour</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Plan specific banners: Expiry & Renewal */}
      {user.plan !== 'FREE' && user.planExpiry && (
        <div className={`glass border-white/10 rounded-2xl p-5 flex items-start space-x-3 animate-in slide-in-from-top-2 duration-500 ${user.planIsCanceled ? 'bg-red-500/5 !border-red-500/20' : 'bg-emerald-500/5 !border-emerald-500/20'}`}>
          <div className={`p-2 rounded-xl border ${user.planIsCanceled ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
            {user.planIsCanceled ? <ShieldAlert className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <p className="text-sm font-bold text-white">
                {user.planIsCanceled ? 'Plan Subscription Canceled' : 'Plan Renewal Information'}
              </p>
              <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${user.planIsCanceled ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {user.planIsCanceled ? 'Expiring' : 'Active'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {user.planIsCanceled
                ? `Your access will end on ${new Date(user.planExpiry).toLocaleDateString(undefined, { dateStyle: 'long' })}${daysLeft && daysLeft > 0 ? ` (${daysLeft} days remaining)` : " soon"}. We're sorry to see you go!`
                : `Your subscription is set to automatically renew on ${new Date(user.planExpiry).toLocaleDateString(undefined, { dateStyle: 'long' })}${daysLeft && daysLeft > 0 ? ` (in ${daysLeft} days)` : " soon"}. Thank you for your support!`}
            </p>
          </div>
        </div>
      )}

      <HostedBotOverviewCard plan={user.plan} onNavigate={onNavigate} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<BarChart3 className="h-5 w-5 text-indigo-400" />}
          label="Today's Generations"
          value={`${genStats?.todayCount ?? 0} / ${genStats?.dailyLimit ?? 3}`}
          sub={`${Math.round(webUsedPct)}% used · web · UTC`}
          barPct={webUsedPct}
          barColor={webUsedPct >= 100 ? 'bg-red-500' : webUsedPct > 75 ? 'bg-amber-500' : 'bg-indigo-500'}
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-emerald-400" />}
          label="API Usage Today"
          value={usageStats ? `${usageStats.todayRequests} / ${usageStats.apiDailyLimit}` : '—'}
          sub={
            usageStats
              ? `${Math.round(Math.min(100, (usageStats.todayRequests / Math.max(1, usageStats.apiDailyLimit)) * 100))}% · UTC day`
              : '—'
          }
          barPct={usageStats ? Math.min(100, (usageStats.todayRequests / Math.max(1, usageStats.apiDailyLimit)) * 100) : 0}
          barColor={usageStats && usageStats.todayRequests >= Math.max(1, usageStats.apiDailyLimit) ? 'bg-red-500' : 'bg-emerald-500'}
        />
        <StatCard
          icon={<Key className="h-5 w-5 text-purple-400" />}
          label="API Burst Limit"
          value={usageStats ? `${usageStats.apiMinuteLimit} / 5s` : '—'}
          sub="key-level burst"
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-amber-400" />}
          label="Total Requests"
          value={String(totalApiReqs)}
          sub="all time"
        />
      </div>

      {showStaffCharts &&
        usageStats?.charts &&
        (usageStats.charts.daily.length > 0 ||
          usageStats.charts.weekly.length > 0 ||
          usageStats.charts.monthly.length > 0) && (
          <ApiUsageTimeSeriesPanel charts={usageStats.charts} />
        )}

      {showStaffCharts &&
        genStats?.charts &&
        (genStats.charts.daily.length > 0 ||
          genStats.charts.weekly.length > 0 ||
          genStats.charts.monthly.length > 0) && (
          <ApiUsageTimeSeriesPanel
            charts={genStats.charts}
            variant="web"
            title="Web generations over time"
          />
        )}

      {/* Upgrade banner for FREE */}
      {user.plan === 'FREE' && (
        <div className="glass !border-indigo-500/20 !bg-indigo-500/5 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <Sparkles className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Scale your implementation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You have core API access on the Free tier, including default upstream generation when a manifest is not cached. Upgrade for higher limits, faster burst rates, and more features.
              </p>
            </div>
          </div>
          <a href="/pricing" className="shrink-0 flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20">
            <span>View Plans</span>
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      )}

      {/* Upstream Ryuu/Morrenus (plan default or admin overrides) */}
      {hasUpstreamAutoGen && (
        <div className="glass !border-purple-500/20 !bg-purple-500/5 rounded-2xl p-5 flex items-start space-x-3">
          <Globe className="h-5 w-5 text-purple-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Auto-generation enabled</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your account can use our upstream pipeline (Ryuu and Morrenus) when a manifest is not already cached. Use{' '}
              <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded font-mono text-[11px]">GET /api/request/&#123;appId&#125;</code>{' '}
              with your API key to auto-generate any Steam manifest on demand.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Endpoint usage breakdown */}
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            <span>Requests by Endpoint</span>
          </h3>
          {!usageStats || Object.keys(usageStats.endpointUsage).length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No API usage recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(usageStats.endpointUsage)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8)
                .map(([ep, count]) => {
                  const max = Math.max(...Object.values(usageStats.endpointUsage))
                  const pct = Math.round((count / max) * 100)
                  return (
                    <div key={ep}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-mono text-indigo-200 truncate max-w-[200px]">{ep}</span>
                        <span className="text-white font-semibold tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* Recent manifests */}
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
            <Package className="h-4 w-4 text-purple-400" />
            <span>Recent Manifests</span>
          </h3>
          {recentManifests.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No manifests generated yet.</p>
          ) : (
            <div className="space-y-2">
              {recentManifests.map(m => (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 group">
                  <div className="flex items-center space-x-3 min-w-0">
                    <span className="text-[10px] font-bold font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
                      {m.steamAppId}
                    </span>
                    <span className="text-sm text-white font-medium truncate">{m.name}</span>
                  </div>
                  <div className="flex items-center space-x-3 shrink-0 ml-3">
                    <span className="text-xs text-muted-foreground flex items-center space-x-1">
                      <Download className="h-3 w-3" />
                      <span>{m.downloads}</span>
                    </span>
                    <a
                      href={`/api/download/${m.steamAppId}`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Voucher Redemption */}
        <div className="glass rounded-2xl p-6 bg-amber-500/5 !border-amber-500/20">
          <h3 className="text-base font-bold text-white mb-2 flex items-center space-x-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <span>Voucher Workshop</span>
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Redeem a code from a reseller to instantly boost your plan.</p>
          <VoucherRedeemer onRedeemed={() => window.location.reload()} />
        </div>

        {/* Quick actions wrapper */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:col-span-1">
          <QuickAction
            icon={<Package className="h-5 w-5" />}
            label="Generate"
            desc="Open web generator"
            onClick={() => window.location.href = '/'}
          />
          <QuickAction
            icon={<Key className="h-5 w-5" />}
            label="API Keys"
            desc="Manage credentials"
            onClick={() => onNavigate('keys')}
          />
          {(user.role === 'TRIAL_MODERATOR' || user.role === 'MODERATOR' || user.role === 'ADMIN' || user.role === 'OWNER') && (
            <QuickAction
              icon={<Server className="h-5 w-5" />}
              label="API Logs"
              desc="System audit logs"
              onClick={() => window.location.href = '/dashboard/api'}
            />
          )}
        </div>
      </div>

      {/* Recent Generations Log */}
      <div className="glass rounded-2xl p-6 mt-6">
        <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>Generation History</span>
        </h3>
        {!genStats || genStats.recentGenerations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center py-6">No generations logged yet.</p>
        ) : (
          <div className="space-y-2">
            {genStats.recentGenerations.map(gen => (
              <div key={gen.id} className={`flex items-center justify-between py-2 border-b border-white/5 last:border-0 group ${gen.isNsfw ? 'bg-red-500/5 -mx-2 px-2 rounded-xl border-red-500/20' : ''}`}>
                <div className="flex items-center space-x-3 min-w-0">
                  <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border shrink-0 ${gen.isNsfw ? 'text-red-300 bg-red-500/10 border-red-500/20' : 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'}`}>
                    {gen.appId}
                  </span>
                  <span className={`text-sm font-medium truncate ${gen.isNsfw ? 'text-red-100' : 'text-white'}`}>{gen.gameName}</span>
                  {gen.isNsfw && (
                    <span className="text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 shrink-0 ml-2 animate-pulse">
                      NSFW
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0 ml-3">
                  {new Date(gen.createdAt).toLocaleDateString()} {new Date(gen.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon, label, value, sub, barPct, barColor
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  barPct?: number
  barColor?: string
}) {
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden group">
      <div className="flex items-center justify-between mb-3">
        <div className="p-2 rounded-xl bg-white/5 border border-white/10">{icon}</div>
      </div>
      <p className="text-2xl font-extrabold text-white tracking-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      {barPct !== undefined && (
        <div className="mt-3 h-1 bg-white/5 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${barColor || 'bg-indigo-500'}`} style={{ width: `${barPct}%` }} />
        </div>
      )}
    </div>
  )
}

function QuickAction({
  icon, label, desc, onClick, highlight
}: {
  icon: React.ReactNode
  label: string
  desc: string
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center space-x-4 p-5 rounded-2xl border text-left transition-all group hover:scale-[1.01] active:scale-[0.99] ${highlight
        ? 'bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/15'
        : 'glass hover:border-white/20'
        }`}
    >
      <div className={`p-2.5 rounded-xl border shrink-0 ${highlight ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400' : 'bg-white/5 border-white/10 text-indigo-400'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-white ml-auto shrink-0 group-hover:translate-x-1 transition-all" />
    </button>
  )
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────
function ApiKeysTab({
  plan, initialKeys, isApiEnabled
}: {
  plan: string
  initialKeys: ApiKeyData[]
  isApiEnabled: boolean
}) {
  const { success: toastSuccess, error: toastError } = useToast()
  const [keys, setKeys] = useState<ApiKeyData[]>(initialKeys)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    setKeys(initialKeys)
  }, [initialKeys])

  const loadKeys = async () => {
    const res = await fetch('/api/keys')
    if (res.ok) setKeys((await res.json()).apiKeys || [])
  }

  const createKey = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName.trim() }),
    })
    setCreating(false)
    if (res.ok) {
      setNewKeyName('')
      setShowCreateForm(false)
      toastSuccess('Key Created', `API Key "${newKeyName}" was created successfully.`)
      loadKeys()
    } else {
      const d = await res.json()
      toastError('Creation Failed', d.error || 'Failed to create key')
    }
  }

  const deleteKey = async (id: string, name: string) => {
    if (!confirm('Permanently revoke this API key?')) return
    const res = await fetch('/api/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId: id }),
    })
    if (res.ok) {
      toastSuccess('Key Revoked', `API Key "${name}" has been permanently deleted.`)
      loadKeys()
    } else {
      toastError('Revocation Failed', 'Failed to delete the API key.')
    }
  }

  const copyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key)
    toastSuccess('Copied to Clipboard', 'The API key has been copied to your clipboard.')
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const maskKey = (key: string) => {
    if (!key) return '••••••••••••'
    return key.substring(0, 8) + '•'.repeat(Math.max(0, key.length - 12)) + key.slice(-4)
  }

  return (
    <div className="glass rounded-3xl p-6 sm:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">API Keys</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Keys are scoped to your plan's rate limits.</p>
        </div>
        {isApiEnabled && (
          <button
            onClick={() => setShowCreateForm(f => !f)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
          >
            <Plus className="h-4 w-4" />
            <span>New Key</span>
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && isApiEnabled && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm font-semibold text-white">Name this integration</p>
          <div className="flex gap-3">
            <input
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createKey()}
              placeholder='e.g. "My Server", "Production App"'
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500 transition-all"
            />
            <button
              onClick={createKey}
              disabled={creating || !newKeyName.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-all"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-xl transition-all text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {keys.length === 0 && isApiEnabled ? (
        <div className="text-center py-12 bg-white/5 border border-dashed border-white/10 rounded-2xl">
          <Key className="h-8 w-8 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No API keys yet — create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(k => {
            const isRevealed = revealedId === k.id
            return (
              <div key={k.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${k.enabled ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="font-semibold text-white truncate">{k.name}</span>
                  </div>
                  <button
                    onClick={() => deleteKey(k.id, k.name)}
                    className="p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all shrink-0"
                    title="Revoke key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Key display */}
                <div className="flex items-center space-x-2">
                  <code className="flex-1 font-mono text-xs bg-black/40 text-indigo-300 px-3 py-2 rounded-xl truncate border border-white/5">
                    {isRevealed ? k.key : maskKey(k.key)}
                  </code>
                  <button
                    onClick={() => setRevealedId(isRevealed ? null : k.id)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-all shrink-0"
                    title={isRevealed ? 'Hide key' : 'Reveal key'}
                  >
                    {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => copyKey(k.id, k.key)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-all shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedId === k.id ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1 border-t border-white/5">
                  <span className="flex items-center space-x-1">
                    <Activity className="h-3 w-3 text-purple-400" />
                    <span>{k._count?.usage ?? 0} total requests</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {k.lastUsed
                        ? `Last used ${new Date(k.lastUsed).toLocaleDateString()}`
                        : 'Never used'}
                    </span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <CheckCircle className="h-3 w-3 text-emerald-400" />
                    <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Game Requests Tab ────────────────────────────────────────────────────────
function GameRequestsTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [requests, setRequests] = useState<any[]>([])
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchRequests = useCallback(async () => {
    const res = await fetch('/api/games/request')
    if (res.ok) setRequests((await res.json()).requests || [])
  }, [])

  useEffect(() => {
    void fetchRequests()
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void fetchRequests()
    }
    const id = window.setInterval(tick, DASHBOARD_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchRequests()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetchRequests])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !appId.trim()) return
    setLoading(true)

    try {
      const res = await fetch('/api/games/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, appId }),
      })
      if (res.ok) {
        toastSuccess('Request Submitted', `Your request for "${name}" was sent to the team.`)
        setName(''); setAppId('')
        fetchRequests()
      } else {
        const data = await res.json().catch(() => ({}))
        toastError('Submission Failed', data.error || 'Failed to submit request.')
      }
    } finally {
      setLoading(false)
    }
  }

  const statusStyle = (s: string) =>
    s === 'PENDING' ? 'bg-amber-500/15 border-amber-500/25 text-amber-400' :
      s === 'DONE' || s === 'FULFILLED' ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' :
        'bg-red-500/15 border-red-500/25 text-red-400'

  return (
    <div className="glass rounded-3xl p-6 sm:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h2 className="text-xl font-bold text-white">Join the Community</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Missing a game? Have a feature idea? Let us know what to add next.</p>
      </div>

      <form onSubmit={submit} className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-200">Game Name / Manifest *</label>
            <input
              required value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 transition-all font-medium"
              placeholder="e.g. Escape From Tarkov"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-200">Steam App ID *</label>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]*"
              value={appId}
              onChange={e => setAppId(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 transition-all font-medium"
              placeholder="e.g. 1357480"
            />
          </div>
        </div>

        <div className="flex items-center space-x-4 pt-2">
          <button
            type="submit" disabled={loading || !name.trim() || !appId.trim()}
            className="flex items-center space-x-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{loading ? 'Submitting…' : 'Submit to Development'}</span>
          </button>
        </div>
      </form>

      {requests.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center space-x-2">
            <Clock className="h-4 w-4 text-indigo-400" />
            <span>Request History</span>
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {requests.map(r => (
              <div key={r.id} className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl gap-4 group hover:bg-white/10 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center space-x-3">
                    <p className="text-sm font-bold text-white truncate">{r.name}</p>
                    <span className={`shrink-0 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-tighter rounded border ${statusStyle(r.status)}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">{r.reason || 'No details'}</p>
                </div>
                <div className="text-[10px] text-muted-foreground/60 whitespace-nowrap tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Database Tab (Admin Only) ────────────────────────────────────────────────
function DatabaseTab() {
  const [data, setData] = useState<{
    manifests: { appId: string; name: string; downloads: number; createdAt: string | null; sizeInStorage: number }[]
    totalCount: number
    storage: { totalBytes: number; manifestCount: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/admin/manifests')
      .then(res => res.json())
      .then(d => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="glass rounded-3xl p-12 flex flex-col items-center justify-center space-y-4">
      <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
      <p className="text-sm text-muted-foreground">Loading database contents...</p>
    </div>
  )

  const filtered = data?.manifests.filter(m =>
    m.appId.includes(search) || m.name.toLowerCase().includes(search.toLowerCase())
  ) || []

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* DB Header stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Server className="h-5 w-5 text-indigo-400" />}
          label="Total Manifests"
          value={String(data?.totalCount ?? 0)}
          sub="Stored in /data"
        />
        <StatCard
          icon={<Globe className="h-5 w-5 text-emerald-400" />}
          label="Storage Usage"
          value={formatSize(data?.storage.totalBytes ?? 0)}
          sub="Total disk used"
        />
        <div className="glass rounded-2xl p-5 flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Database Actions</p>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search AppID or Name..."
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 transition-all font-medium"
            />
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/5">
                <th className="px-6 py-4">App ID</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4">Downloads</th>
                <th className="px-6 py-4">Stored Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(m => (
                <tr key={m.appId} className="hover:bg-white/5 transition-colors group border-b border-white/5 last:border-0 cursor-default">
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-indigo-300 font-mono">{m.appId}</span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-white max-w-[300px] truncate">{m.name}</p>
                  </td>
                  <td className="px-6 py-4 text-xs tabular-nums text-muted-foreground">
                    {formatSize(m.sizeInStorage)}
                  </td>
                  <td className="px-6 py-4 text-xs tabular-nums text-muted-foreground">
                    <span className="flex items-center space-x-1">
                      <Download className="h-3 w-3" />
                      <span>{m.downloads}</span>
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : 'N/A'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center italic text-muted-foreground">
                    No manifests found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Webhooks Tab ─────────────────────────────────────────────────────────────
function WebhooksTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/user/webhooks')
      if (res.ok) {
        const data = await res.json()
        setWebhookUrl(data.webhookUrl || '')
        setWebhookSecret(data.webhookSecret || '')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadConfig() }, [])

  const save = async (generateSecret = false) => {
    setSaving(true)
    try {
      const res = await fetch('/api/user/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl, generateSecret }),
      })
      if (res.ok) {
        const data = await res.json()
        setWebhookUrl(data.webhookUrl || '')
        setWebhookSecret(data.webhookSecret || '')
        toastSuccess('Settings Saved', 'Your webhook configuration has been updated.')
      } else {
        toastError('Save Failed', 'Failed to update webhook settings.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-6 w-6 text-indigo-500 animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="glass rounded-3xl p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">External Webhooks</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Receive real-time notifications on your own server when events occur (e.g., manifest generation).
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-200">Webhook URL</label>
            <div className="flex gap-3">
              <input
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/api/webhook"
                className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 transition-all"
              />
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save URL'}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Leave empty to disable external notifications.
            </p>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-200">HMAC Secret</label>
            <div className="flex items-center space-x-2">
              <code className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-indigo-300 font-mono truncate">
                {webhookSecret || 'No secret generated'}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(webhookSecret)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                disabled={!webhookSecret}
                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 text-muted-foreground hover:text-white transition-all"
                title="Copy Secret"
              >
                {copied ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  if (confirm('Regenerating will invalidate your current secret immediately. Continue?')) {
                    save(true)
                  }
                }}
                disabled={saving}
                className="flex items-center space-x-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-xs font-bold transition-all"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Used to sign payload in <code className="text-indigo-300">X-OpenSteam-Signature</code> header.
            </p>
            <button
              onClick={async () => {
                const res = await fetch('/api/user/webhooks/test', { method: 'POST' })
                if (res.ok) toastSuccess('Test sent', 'Check your webhook endpoint for the test event.')
                else toastError('Test failed', 'Save a webhook URL first or check your plan.')
              }}
              className="mt-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-xs font-bold transition-all"
            >
              Send test event
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5 border-l-4 border-l-indigo-500">
          <div className="flex items-center space-x-2 mb-2">
            <KeyRound className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-tight">Security</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            All requests include an HMAC SHA256 signature calculated from the raw request body using your secret.
            Verify this on your server to ensure the event originated from OpenSteam.
          </p>
        </div>
        <div className="glass rounded-2xl p-5 border-l-4 border-l-purple-500">
          <div className="flex items-center space-x-2 mb-2">
            <Globe className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-tight">Payload Structure</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Webhooks are sent as JSON POST requests. Includes <code className="text-purple-300">event</code>,
            <code className="text-purple-300">timestamp</code>, and <code className="text-purple-300">data</code> object.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Forge Tab ────────────────────────────────────────────────────────────────
function ForgeTab({ user: currentUser }: { user: any }) {
  const { success: toastSuccess, error: toastError } = useToast()
  const [subTab, setSubTab] = useState<'my' | 'public' | 'profiles'>('my')
  const [loading, setLoading] = useState(true)
  const [scripts, setScripts] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [showEditor, setShowEditor] = useState(false)
  const [viewingScript, setViewingScript] = useState<any | null>(null)

  // Editor state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editIsPublic, setEditIsPublic] = useState(false)
  const [editLanguage, setEditLanguage] = useState('javascript')
  const [saving, setSaving] = useState(false)

  const languages = [
    { id: 'javascript', label: 'JavaScript', color: 'text-yellow-400' },
    { id: 'json', label: 'JSON', color: 'text-indigo-400' },
    { id: 'css', label: 'CSS', color: 'text-blue-400' },
    { id: 'lua', label: 'Lua', color: 'text-sky-400' },
    { id: 'sql', label: 'SQL', color: 'text-emerald-400' },
  ]

  const fetchData = async () => {
    setLoading(true)
    try {
      if (subTab === 'profiles') {
        const res = await fetch('/api/forge/profiles')
        if (res.ok) setProfiles((await res.json()).profiles || [])
      } else {
        const res = await fetch(`/api/forge/scripts?type=${subTab === 'my' ? 'my' : 'public'}`)
        if (res.ok) setScripts((await res.json()).scripts || [])
      }
    } finally {
      setLoading(false)
    }
  }

  const toggleStar = async (id: string) => {
    try {
      const res = await fetch(`/api/forge/scripts/${id}/star`, { method: 'POST' })
      if (res.ok) {
        const { starred, count } = await res.json()
        setScripts(prev => prev.map(s => s.id === id ? { ...s, isStarred: starred, starCount: count } : s))
      }
    } catch (err) {
      console.error('Star toggle failed', err)
    }
  }

  useEffect(() => { fetchData() }, [subTab])

  const openEditor = (script: any = null) => {
    if (script) {
      setViewingScript(script)
      setEditName(script.name)
      setEditDesc(script.description || '')
      setEditContent(script.content)
      setEditIsPublic(script.isPublic)
      setEditLanguage(script.language || 'javascript')
    } else {
      setViewingScript(null)
      setEditName('')
      setEditDesc('')
      setEditContent('')
      setEditIsPublic(false)
      setEditLanguage('javascript')
    }
    setShowEditor(true)
  }

  const saveScript = async () => {
    if (!editName || !editContent) return
    setSaving(true)
    try {
      const isEditing = !!viewingScript
      const url = isEditing ? `/api/forge/scripts/${viewingScript.id}` : '/api/forge/scripts'
      const method = isEditing ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDesc,
          content: editContent,
          isPublic: editIsPublic,
          language: editLanguage
        })
      })
      if (res.ok) {
        toastSuccess(isEditing ? 'Script Updated' : 'Script Created', `Your Workshop script "${editName}" is now ready.`)
        setShowEditor(false)
        setViewingScript(null)
        setEditName(''); setEditDesc(''); setEditContent(''); setEditIsPublic(false); setEditLanguage('javascript')
        fetchData()
      } else {
        toastError(isEditing ? 'Update Failed' : 'Creation Failed', 'Failed to save your script.')
      }
    } finally {
      setSaving(false)
    }
  }

  const isAuthor = !viewingScript || viewingScript.authorId === (currentUser as any).id
  const isWorkshopMode = showEditor && isAuthor
  const isViewerMode = showEditor && !isAuthor

  const deleteScript = async () => {
    if (!viewingScript || !window.confirm('Are you sure you want to permanently delete this script?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/forge/scripts/${viewingScript.id}`, { method: 'DELETE' })
      if (res.ok) {
        toastSuccess('Script Deleted', 'The script has been removed from your collection.')
        setShowEditor(false)
        setViewingScript(null)
        fetchData()
      } else {
        toastError('Delete Failed', 'Failed to remove script.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Forge Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-3">
            <Sparkles className="h-6 w-6 text-indigo-400" />
            <span>Forge Script Workshop</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Customize extraction logic with sandboxed scripts and profiles.</p>
        </div>
        {!showEditor && (
          <button
            onClick={() => openEditor()}
            className="flex items-center space-x-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-500/20"
          >
            <Plus className="h-4 w-4" />
            <span>Create New Script</span>
          </button>
        )}
      </div>

      {showEditor ? (
        <div className="glass rounded-3xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-white/5">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                <Code className="h-5 w-5 text-indigo-400" />
              </div>
              <h3 className="text-lg font-bold text-white tracking-tight uppercase tracking-widest">
                {isAuthor ? 'Logic Workshop' : 'Script Viewer'}
              </h3>
            </div>
            <button onClick={() => { setShowEditor(false); setViewingScript(null); }} className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-white transition-colors bg-white/5 px-4 py-2 rounded-xl border border-white/10">
              {isAuthor ? 'Cancel Workshop' : 'Close Viewer'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-indigo-300 ml-1">Script Metadata</label>
                <div className="space-y-4">
                  <input
                    value={editName} onChange={e => setEditName(e.target.value)}
                    disabled={!isAuthor}
                    className="w-full bg-black/50 border border-white/10 rounded-2xl px-5 py-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-inner disabled:opacity-60"
                    placeholder="e.g. SteamDB Tagger Pro"
                  />
                  <textarea
                    value={editDesc} onChange={e => setEditDesc(e.target.value)}
                    disabled={!isAuthor}
                    className="w-full bg-black/50 border border-white/10 rounded-2xl px-5 py-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all h-24 resize-none shadow-inner disabled:opacity-60"
                    placeholder="Describe what this extension does..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-indigo-300 ml-1">Deployment Settings</label>
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-[1.5rem] border border-white/10">
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-white">Public Marketplace</p>
                      <p className="text-[10px] text-muted-foreground font-medium">Allow other creators to use this script.</p>
                    </div>
                    <button
                      onClick={() => isAuthor && setEditIsPublic(!editIsPublic)}
                      disabled={!isAuthor}
                      className={`w-12 h-6 rounded-full transition-all relative ${editIsPublic ? 'bg-indigo-500 shadow-lg shadow-indigo-500/40' : 'bg-white/10'} ${!isAuthor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm ${editIsPublic ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="p-4 bg-white/5 rounded-[1.5rem] border border-white/10 space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-indigo-300 ml-1">Logic Language</label>
                    <div className="flex flex-wrap gap-2">
                      {languages.map(lang => (
                        <button
                          key={lang.id}
                          onClick={() => isAuthor && setEditLanguage(lang.id)}
                          disabled={!isAuthor}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${editLanguage === lang.id
                              ? 'bg-indigo-500 border-indigo-500 text-white shadow-lg'
                              : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'
                            } ${!isAuthor && editLanguage !== lang.id ? 'opacity-30' : ''}`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2 flex flex-col h-full">
                <label className="text-[10px] font-black uppercase tracking-widest text-indigo-300 ml-1 flex items-center justify-between">
                  <span>Extension Workspace</span>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-mono opacity-40">node-v20-lts-sandbox</span>
                  </div>
                </label>
                <div className="flex-1 min-h-[420px] relative group overflow-hidden rounded-[2rem] border border-white/10 bg-[#0F0F11] shadow-2xl flex flex-col">
                  {/* Top Bar / Tabs Mock */}
                  <div className="h-9 bg-black/40 border-b border-white/5 flex items-center px-4 space-x-2">
                    <div className="flex items-center space-x-2 bg-white/5 px-3 py-1 rounded-t-lg border-x border-t border-white/10 h-full mt-2">
                      <Code className="h-3 w-3 text-indigo-400" />
                      <span className="text-[10px] font-mono text-white/80">{editName || 'untitled'}.{editLanguage === 'javascript' ? 'js' : editLanguage === 'lua' ? 'lua' : editLanguage === 'sql' ? 'sql' : 'txt'}</span>
                    </div>
                  </div>

                  <div className="flex-1 relative flex">
                    {/* Line Numbers */}
                    <div className="w-12 bg-black/40 border-r border-white/5 flex flex-col items-center pt-4 space-y-0.5 pointer-events-none select-none">
                      {[...Array(25)].map((_, i) => (
                        <span key={i} className="text-[9px] font-mono text-white/10 leading-5">{i + 1}</span>
                      ))}
                    </div>

                    <textarea
                      value={editContent} onChange={e => isAuthor && setEditContent(e.target.value)}
                      spellCheck={false}
                      readOnly={!isAuthor}
                      className="flex-1 bg-transparent px-4 py-4 text-xs font-mono text-indigo-300 outline-none transition-all resize-none z-10 leading-5 placeholder:text-white/5"
                      placeholder={`// Extension logic here...\nif (manifest.id === '730') {\n  manifest.tags.push('Elite');\n}`}
                    />
                  </div>

                  {/* VS Code Style Status Bar */}
                  <div className="h-6 bg-indigo-600 flex items-center justify-between px-4 text-[9px] font-bold text-white/90">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1.5 hover:bg-white/10 px-2 h-full cursor-default">
                        <Layout className="h-3 w-3" />
                        <span>Main</span>
                      </div>
                      <div className="flex items-center space-x-1.5 hover:bg-white/10 px-2 h-full cursor-default">
                        <RefreshCw className="h-3 w-3" />
                        <span>{isAuthor ? 'Syncing...' : 'Read Only'}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4 h-full">
                      <span className="hover:bg-white/10 px-2 h-full flex items-center uppercase">{editLanguage}</span>
                      <span className="hover:bg-white/10 px-2 h-full flex items-center">UTF-8</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6 border-t border-white/5">
            <div className="flex items-center space-x-4">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full border-2 border-[#0A0A0B] bg-indigo-500 flex items-center justify-center text-[10px] font-black">JS</div>
                <div className="w-8 h-8 rounded-full border-2 border-[#0A0A0B] bg-emerald-500 flex items-center justify-center text-[10px] font-black">LUA</div>
                <div className="w-8 h-8 rounded-full border-2 border-[#0A0A0B] bg-amber-500 flex items-center justify-center text-[10px] font-black">{ }</div>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Multi-Runtime Support Active</p>
            </div>

            <div className="flex items-center space-x-3">
              {isAuthor && viewingScript && (
                <button
                  onClick={deleteScript}
                  className="flex items-center space-x-2 px-6 py-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Discard Project</span>
                </button>
              )}
              {isAuthor ? (
                <button
                  onClick={saveScript}
                  disabled={saving || !editName || !editContent}
                  className="flex items-center space-x-3 px-10 py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-[1.5rem] text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20 disabled:opacity-50 active:scale-95 group"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 group-hover:translate-x-1 transition-transform" />}
                  <span>{saving ? 'Forging Content…' : (viewingScript ? 'Update Content' : 'Deploy Extension')}</span>
                </button>
              ) : (
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic pr-6">Viewing source from @{viewingScript?.author.username}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sub-tabs */}
          <div className="flex items-center space-x-1 p-1 bg-white/5 border border-white/10 rounded-2xl w-fit">
            {[
              { id: 'my', label: 'My Collection', icon: <Star className="h-4 w-4" /> },
              { id: 'public', label: 'Marketplace', icon: <Users className="h-4 w-4" /> },
              { id: 'profiles', label: 'Profiles', icon: <Layout className="h-4 w-4" /> },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id as any)}
                className={`flex items-center space-x-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all border ${subTab === t.id ? 'bg-indigo-500 text-white shadow-lg border-indigo-400' : 'text-muted-foreground hover:text-white hover:bg-white/5 border-transparent'
                  }`}
              >
                {t.icon}
                <span className="uppercase tracking-widest font-black text-[10px]">{t.id === 'public' ? 'Script Share' : t.label}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center space-y-4">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
              <p className="text-sm text-muted-foreground italic">Consulting the Forge archives...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
              {subTab === 'profiles' ? (
                <>
                  {profiles.length === 0 ? (
                    <div className="col-span-full py-12 text-center glass rounded-3xl border-dashed">
                      <Layout className="h-8 w-8 text-white/5 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No manifest profiles created yet.</p>
                    </div>
                  ) : (
                    profiles.map(p => (
                      <div key={p.id} className="glass rounded-[2rem] p-6 hover:border-indigo-500/30 transition-all group border border-white/5">
                        <div className="flex items-start justify-between mb-3">
                          <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 shadow-inner">
                            <Layout className="h-5 w-5 text-purple-400" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{new Date(p.createdAt).toLocaleDateString()}</span>
                        </div>
                        <h4 className="text-sm font-black uppercase tracking-widest text-white mb-2">{p.name}</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{p.description || 'No description provided.'}</p>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <>
                  {scripts.length === 0 ? (
                    <div className="col-span-full py-12 text-center glass rounded-3xl border-dashed">
                      <Star className="h-8 w-8 text-white/5 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No extensions found in this view.</p>
                    </div>
                  ) : (
                    scripts.map((s: any) => {
                      const authorAv = getDiscordCdnAvatarUrl(s.author?.discordId, s.author?.avatar, 40)
                      return (
                      <div
                        key={s.id}
                        onClick={() => openEditor(s)}
                        className="glass rounded-[2rem] p-6 hover:border-indigo-500/40 hover:shadow-2xl hover:shadow-indigo-500/10 transition-all group relative overflow-hidden border border-white/5 cursor-pointer active:scale-[0.98]"
                      >
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center space-x-2">
                            {s.authorId === (currentUser as any).id ? <Plus className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            <span>{s.authorId === (currentUser as any).id ? 'Open Workshop' : 'View Workspace'}</span>
                          </div>
                        </div>

                        <div className="flex items-start justify-between mb-4">
                          <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 shadow-inner group-hover:bg-indigo-500/20 transition-colors">
                            <Code className="h-5 w-5 text-indigo-400" />
                          </div>
                          <div className="flex flex-col items-end space-y-2">
                            <div className="flex items-center space-x-1.5">

                              <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${s.language === 'javascript' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                  s.language === 'lua' ? 'bg-sky-500/10 text-sky-500 border-sky-500/20' :
                                    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                }`}>
                                {s.language || 'JS'}
                              </span>
                            </div>
                            <span className="text-[10px] font-bold text-amber-400 flex items-center space-x-1">
                              <Star className="h-3 w-3 fill-amber-400" />
                              <span>{s.starCount || 0}</span>
                            </span>
                          </div>
                        </div>

                        <h4 className="text-sm font-black uppercase tracking-widest text-white mb-2 flex items-center space-x-2 overflow-hidden">
                          <span className="truncate">{s.name}</span>
                          {s.isPublic && <Globe className="h-3 w-3 text-emerald-400 opacity-60 flex-shrink-0" />}
                        </h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-6 h-8 leading-relaxed italic">{s.description || 'Custom sandboxed logic.'}</p>

                        <div className="flex items-center justify-between pt-4 border-t border-white/5 relative z-20">
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleStar(s.id); }}
                              className={`px-3 py-1.5 rounded-xl transition-all border font-bold text-[9px] uppercase tracking-widest ${s.isStarred
                                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                : 'bg-white/5 text-muted-foreground border-white/5 hover:text-white hover:bg-white/10'
                                }`}
                            >
                              {s.isStarred ? 'Unstar' : 'Star'}
                            </button>
                            <span className="text-[9px] text-muted-foreground/60 font-black uppercase tracking-tighter ml-2">{s.usageCount} executions</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <div className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[8px] font-black text-white uppercase italic overflow-hidden shadow-sm">
                              {authorAv ? <img src={authorAv} alt="Author" className="object-cover w-full h-full" /> : s.author.username[0]}
                            </div>
                            <span className="text-[9px] font-bold text-white/40">@{s.author.username}</span>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  )
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VoucherRedeemer({ onRedeemed }: { onRedeemed: () => void }) {
  const { success: toastSuccess, error: toastError } = useToast()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const redeem = async () => {
    if (!code) return
    setLoading(true)
    try {
      const res = await fetch('/api/user/vouchers/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Success', data.message)
        setCode('')
        setTimeout(onRedeemed, 1500)
      } else {
        toastError('Redemption Failed', data.error)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center space-x-2">
      <input
        value={code} onChange={e => setCode(e.target.value)}
        placeholder="GG-XXXX-XXXX"
        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none focus:border-amber-500/50 transition-all uppercase"
      />
      <button
        onClick={redeem} disabled={loading || !code}
        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-black rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-amber-500/10"
      >
        {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'ACTIVATE'}
      </button>
    </div>
  )
}

function ComingSoonPlaceholder({ featureName }: { featureName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="relative">
        <div className="absolute inset-0 bg-indigo-500/20 blur-[80px] rounded-full"></div>
        <div className="glass rounded-[3rem] p-10 flex items-center justify-center relative border border-white/10 shadow-2xl overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <Sparkles className="h-16 w-16 text-indigo-400 group-hover:scale-110 transition-transform duration-500 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
        </div>
      </div>
      <div className="text-center space-y-4 max-w-md relative">
        <div className="inline-block px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-black uppercase tracking-widest mb-2 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
          In Development
        </div>
        <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-200 to-white uppercase tracking-tight">
          {featureName} is Coming Soon
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We are completely overhauling the {featureName} experience to bring you unparalleled tools and a pristine workflow. Only administrators have early access while we polish the final details. Stay tuned!
        </p>
      </div>
    </div>
  )
}

function TeamTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const { data: session, update } = useSession()
  const user = (session?.user as any) || {}

  const [switching, setSwitching] = useState<string | null>(null)
  const [orgs, setOrgs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/orgs')
      if (res.ok) setOrgs((await res.json()).orgs || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const switchOrg = async (orgId: string) => {
    if (orgId === user.activeOrgId) return
    setSwitching(orgId)
    try {
      const res = await fetch('/api/orgs/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId })
      })
      if (res.ok) {
        toastSuccess('Context Switched', 'Active organization context updated.')
        await update() // Refresh session
      } else {
        toastError('Switch Failed', 'Failed to update organization context.')
      }
    } finally {
      setSwitching(null)
    }
  }

  const createOrg = async () => {
    if (!newOrgName) return
    setCreating(true)
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName })
      })
      if (res.ok) {
        toastSuccess('Organization Created', `"${newOrgName}" is now active.`)
        setNewOrgName('')
        fetchData()
        await update() // Refresh to get new activeOrgId
      } else {
        toastError('Creation Failed', 'Failed to create organization.')
      }
    } finally {
      setCreating(false)
    }
  }

  const [inviteDiscordId, setInviteDiscordId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [members, setMembers] = useState<any[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(false)

  const fetchInvites = async () => {
    setLoadingInvites(true)
    try {
      const res = await fetch('/api/orgs?invites=true')
      if (res.ok) setInvites((await res.json()).orgs || [])
    } finally {
      setLoadingInvites(false)
    }
  }

  const fetchMembers = async (orgId: string) => {
    if (!orgId) return
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/orgs?orgId=${orgId}`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.org?.members || [])
      }
    } catch (err) {
      console.error('Fetch members error:', err)
    } finally {
      setLoadingMembers(false)
    }
  }

  useEffect(() => {
    fetchData()
    fetchInvites()
  }, [])

  useEffect(() => {
    if (user.activeOrgId) {
      fetchMembers(user.activeOrgId)
    }
  }, [user.activeOrgId])

  const acceptInvite = async (orgId: string) => {
    try {
      const res = await fetch('/api/orgs/members/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId })
      })
      if (res.ok) {
        toastSuccess('Invitation Accepted', 'You are now a member of the organization.')
        fetchData()
        fetchInvites()
        await update() // Refresh session
      } else {
        const data = await res.json()
        toastError('Failed to join', data.error)
      }
    } catch (err) {
      console.error('Accept invite error:', err)
    }
  }

  const declineInvite = async (orgId: string) => {
    if (!orgId || !user.id) return;
    if (!confirm('Decline this invitation?')) return
    try {
      const res = await fetch('/api/orgs/members', { // DELETE endpoint handles removal
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userId: user.id })
      })
      if (res.ok) {
        toastSuccess('Invitation Declined', 'The request has been removed.')
        fetchInvites()
        fetchData() // Refresh list
      }
    } catch (err) {
      console.error('Decline invite error:', err)
    }
  }

  const inviteMember = async () => {
    if (!inviteDiscordId || !user.activeOrgId) return
    setInviting(true)
    try {
      const res = await fetch('/api/orgs/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: user.activeOrgId, discordId: inviteDiscordId })
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Member Invited', `${data.user.username} has been sent a pending request.`)
        setInviteDiscordId('')
        fetchMembers(user.activeOrgId)
      } else {
        toastError('Invitation Failed', data.error)
      }
    } finally {
      setInviting(false)
    }
  }

  const removeMember = async (userId: string) => {
    const orgId = user.activeOrgId;
    if (!orgId || !userId) {
      toastError('Error', 'Missing organization or user context.');
      return;
    }
    if (!confirm('Are you sure you want to remove this member?')) return
    try {
      const res = await fetch('/api/orgs/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userId })
      })
      if (res.ok) {
        toastSuccess('Membership Terminated', 'The user has been removed from the team.')
        fetchMembers(orgId)
      } else {
        const data = await res.json()
        toastError('Removal Failed', data.error)
      }
    } catch (err) {
      console.error('Remove member error:', err)
    }
  }

  const deleteOrg = async (orgId: string, orgName: string) => {
    if (!window.confirm(`Are you absolutely sure you want to permanently disband the enterprise "${orgName}"?`)) return
    try {
      const res = await fetch('/api/orgs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId })
      })
      if (res.ok) {
        toastSuccess('Enterprise Disbanded', `"${orgName}" has been permanently deleted.`)
        fetchData()
        await update() // Refresh session
      } else {
        const data = await res.json().catch(() => ({}))
        toastError('Deletion Failed', data.error || 'Failed to delete workspace.')
      }
    } catch (err) {
      console.error('Delete org error:', err)
      toastError('Error', 'Connection failure.')
    }
  }

  // Find active org to check role
  const activeOrg = orgs.find(o => o.id === user.activeOrgId)
  const isOwner = activeOrg?.userRole === 'OWNER' || user.role === 'ADMIN' || user.role === 'OWNER'

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
        <div className="absolute -inset-x-6 -inset-y-4 bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent blur-2xl -z-10 rounded-full" />
        <div>
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-indigo-200 flex items-center space-x-3 tracking-tight">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <Users className="h-6 w-6 text-indigo-400" />
            </div>
            <span>Workspace Network</span>
          </h2>
          <p className="text-sm text-indigo-200/60 mt-2 font-medium">Coordinate your collaborative enterprise structures and shared resources.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Management Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass rounded-[2rem] p-6 space-y-5 border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent relative overflow-hidden group">
            <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
              <span>Initialize Workspace</span>
            </h3>
            
            <div className="space-y-4 relative z-10">
              <div className="relative group/input">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500/30 to-purple-500/30 rounded-xl blur opacity-0 group-hover/input:opacity-100 transition duration-500" />
                <input
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  placeholder="Enterprise Name"
                  className="relative w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-500/50 transition-all shadow-inner backdrop-blur-xl"
                />
              </div>
              <button
                onClick={createOrg}
                disabled={creating || !newOrgName}
                className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] border border-indigo-400/20 hover:-translate-y-0.5 duration-300"
              >
                {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                <span>{creating ? 'Processing...' : 'Deploy Workspace'}</span>
              </button>
            </div>
          </div>

          {activeOrg && isOwner && (
            <div className="glass rounded-[2rem] p-6 space-y-5 border border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent relative overflow-hidden group shadow-[0_0_30px_rgba(168,85,247,0.05)]">
              <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                <UserPlus className="h-24 w-24 text-purple-400" />
              </div>
              
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2 relative z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                <span>Onboard Member</span>
              </h3>
              
              <div className="space-y-4 relative z-10">
                <div className="relative group/input">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500/30 to-pink-500/30 rounded-xl blur opacity-0 group-hover/input:opacity-100 transition duration-500" />
                  <input
                    value={inviteDiscordId}
                    onChange={e => setInviteDiscordId(e.target.value)}
                    placeholder="Discord Snowflake ID"
                    className="relative w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-purple-500/50 transition-all font-mono shadow-inner backdrop-blur-xl"
                  />
                </div>
                <button
                  onClick={inviteMember}
                  disabled={inviting || !inviteDiscordId}
                  className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)] border border-purple-400/20 hover:-translate-y-0.5 duration-300"
                >
                  {inviting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span>{inviting ? 'Transmitting...' : 'Dispatch Invitation'}</span>
                </button>
              </div>
            </div>
          )}

          {activeOrg && isOwner && (
            <div className="glass rounded-[2rem] p-6 space-y-5 border border-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent relative overflow-hidden group shadow-[0_0_30px_rgba(239,68,68,0.05)]">
              <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                <ShieldAlert className="h-24 w-24 text-red-400" />
              </div>
              
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2 relative z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                <span>Danger Zone</span>
              </h3>
              
              <div className="space-y-3 relative z-10">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Permanently delete this organization. This will immediately revoke access for all members and delete associated keys.
                </p>
                <button
                  onClick={() => deleteOrg(activeOrg.id, activeOrg.name)}
                  className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-xl text-xs font-black uppercase tracking-widest transition-all border border-red-500/20 hover:border-red-500/40"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Disband Enterprise</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Lists & Details */}
        <div className="lg:col-span-8 space-y-8">
          {/* Invites Section */}
          {invites.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
              <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 animate-pulse" />
                <span>Pending Access Requests ({invites.length})</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {invites.map(invite => (
                  <div key={invite.id} className="glass rounded-2xl p-5 border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent relative overflow-hidden group shadow-[0_0_20px_rgba(245,158,11,0.05)] hover:shadow-[0_0_30px_rgba(245,158,11,0.15)] transition-all">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-bl-full blur-xl group-hover:bg-amber-500/20 transition-colors" />
                    <div className="flex flex-col space-y-4 relative z-10">
                      <div className="flex items-center space-x-3">
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 shadow-inner">
                          <Users className="h-4 w-4 text-amber-400" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-white">{invite.name}</h4>
                          <p className="text-[10px] text-amber-200/60 font-medium uppercase tracking-widest mt-0.5">
                            Authority: <span className="text-amber-400">{invite.owner?.username || 'Unknown'}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => acceptInvite(invite.id)}
                          className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.4)] border border-emerald-400/20"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => declineInvite(invite.id)}
                          className="px-4 py-2 bg-white/5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/5 hover:border-red-500/20"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Workspaces Section */}
          <div className="space-y-5">
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2 opacity-80">
              <Globe className="h-4 w-4 text-emerald-400" />
              <span>Network Topologies</span>
            </h3>

            {loading ? (
              <div className="glass rounded-[2rem] p-16 flex flex-col items-center justify-center space-y-4 border border-white/5 shadow-inner">
                <div className="relative">
                  <div className="absolute inset-0 border-t-2 border-indigo-500 rounded-full animate-spin blur-sm" />
                  <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Syncing Network Topology...</p>
              </div>
            ) : orgs.length === 0 ? (
              <div className="glass rounded-[2rem] p-16 text-center border border-white/5 bg-black/20 shadow-inner">
                <Users className="h-12 w-12 text-white/5 mx-auto mb-4" />
                <p className="text-sm font-medium text-muted-foreground">You are completely isolated. Initialize a workspace to begin.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {orgs.map(org => {
                  const isActive = org.id === user.activeOrgId
                  const isSwitching = switching === org.id
                  const isPending = org.status === 'PENDING'

                  return (
                    <div
                      key={org.id}
                      onClick={() => !isPending && switchOrg(org.id)}
                      className={`glass rounded-[1.5rem] p-5 transition-all duration-300 group border overflow-hidden relative ${
                        isPending 
                          ? 'opacity-60 cursor-not-allowed border-white/5' 
                          : isActive
                            ? 'bg-gradient-to-r from-indigo-500/10 to-purple-500/5 border-indigo-500/40 shadow-[0_0_30px_rgba(99,102,241,0.15)] cursor-default'
                            : 'bg-white/[0.02] border-white/5 hover:border-indigo-500/30 hover:bg-white/[0.04] cursor-pointer hover:shadow-[0_0_20px_rgba(99,102,241,0.05)]'
                        }`}
                    >
                      {isActive && (
                        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-purple-500 shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
                      )}
                      <div className="flex items-center justify-between relative z-10 pl-2">
                        <div className="flex items-center space-x-5">
                          <div className={`p-3.5 rounded-2xl transition-all duration-500 ${
                            isActive 
                              ? 'bg-indigo-500/20 border border-indigo-500/30 shadow-inner' 
                              : 'bg-black/40 border border-white/5 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/20'
                            }`}>
                            <Users className={`h-5 w-5 ${isActive ? 'text-indigo-400' : 'text-muted-foreground group-hover:text-indigo-400'}`} />
                          </div>
                          <div>
                            <div className="flex items-center space-x-3 mb-1">
                              <h4 className={`text-base font-black tracking-tight ${isActive ? 'text-white' : 'text-white/80 group-hover:text-white'}`}>{org.name}</h4>
                              {isActive && (
                                <span className="px-2 py-0.5 rounded-md bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest shadow-[0_0_10px_rgba(99,102,241,0.5)]">Connected</span>
                              )}
                              {isPending && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-black uppercase tracking-widest">Awaiting Link</span>
                              )}
                            </div>
                            <div className="flex items-center space-x-3">
                              <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                                isActive ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' : 'bg-white/5 text-muted-foreground border-white/5'
                              }`}>
                                {org.plan} Tier
                              </span>
                              <span className="w-1 h-1 rounded-full bg-white/20" />
                              <span className="text-[10px] text-muted-foreground font-medium">{org._count?.members || 0} Operators</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <div className="flex flex-col items-end">
                            <span className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-widest mb-1">Clearance</span>
                            <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-indigo-200' : 'text-muted-foreground'}`}>{org.userRole}</span>
                          </div>
                          <div className={`p-2.5 rounded-xl transition-all duration-300 border ${
                            isActive
                              ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                              : 'bg-black/40 text-muted-foreground border-white/5 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 group-hover:border-indigo-500/20'
                            }`}>
                            {isSwitching ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : isActive ? (
                              <CheckCircle className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Members Table Section */}
          {activeOrg && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2 opacity-80">
                <ShieldCheck className="h-4 w-4 text-purple-400" />
                <span>Personnel Roster</span>
              </h3>
              <div className="glass rounded-[2rem] overflow-hidden border border-white/5 bg-black/20 shadow-2xl relative">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                
                <table className="w-full text-left border-collapse relative z-10">
                  <thead>
                    <tr className="bg-white/[0.02] border-b border-white/5">
                      <th className="px-6 py-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest w-1/2">Operator Profile</th>
                      <th className="px-6 py-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Clearance Level</th>
                      <th className="px-6 py-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest text-right">Directives</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loadingMembers ? (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <RefreshCw className="h-6 w-6 animate-spin text-indigo-500/50" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Decrypting Roster...</span>
                          </div>
                        </td>
                      </tr>
                    ) : members.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-xs font-medium text-muted-foreground">
                          No personnel assigned to this workspace.
                        </td>
                      </tr>
                    ) : (
                      members.filter((m: any) => m?.user).map((m: any) => {
                        const memberAv = getDiscordCdnAvatarUrl(m.user.discordId, m.user.avatar, 64)
                        return (
                          <tr key={m.id} className="group hover:bg-white/[0.03] transition-colors duration-300">
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-4">
                                <div className="relative">
                                  <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-900 to-black border-2 border-white/10 flex items-center justify-center text-[12px] font-black text-white uppercase overflow-hidden relative z-10 shadow-inner group-hover:border-indigo-500/50 transition-colors">
                                    {memberAv ? <img src={memberAv} alt="" className="w-full h-full object-cover" /> : (m.user.username?.[0] ?? "?")}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-sm font-black text-white tracking-tight">{m.user.username ?? "Unknown"}</p>
                                  <div className="flex items-center space-x-1.5 mt-0.5">
                                    <span className="text-[9px] font-mono text-muted-foreground/70">ID:</span>
                                    <span className="text-[9px] font-mono text-indigo-300/70">{m.user.discordId}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center justify-center text-[9px] font-black px-2.5 py-1 rounded-md border ${
                                m.role === 'OWNER' 
                                  ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]' 
                                  : 'bg-black/40 text-muted-foreground border-white/10'
                                }`}>
                                {m.role}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {isOwner && m.role !== 'OWNER' ? (
                                <button
                                  onClick={() => removeMember(m.userId)}
                                  className="p-2.5 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 border border-transparent transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-red-500/50 group/btn"
                                  title="Revoke Access"
                                >
                                  <Trash2 className="h-4 w-4 group-hover/btn:scale-110 transition-transform" />
                                </button>
                              ) : (
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function BecomeReseller() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="relative">
        <div className="absolute inset-0 bg-indigo-500/20 blur-[80px] rounded-full"></div>
        <div className="glass rounded-[3rem] p-10 flex items-center justify-center relative border border-white/10 shadow-2xl overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <Package className="h-16 w-16 text-indigo-400 group-hover:scale-110 transition-transform duration-500 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
        </div>
      </div>
      <div className="text-center space-y-6 max-w-2xl relative px-4">
        <div className="inline-block px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-black uppercase tracking-widest shadow-[0_0_15px_rgba(99,102,241,0.2)]">
          Reseller Program
        </div>
        <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-200 to-white uppercase tracking-tight">
          Distribute & Profit
        </h2>
        <p className="text-muted-foreground text-base leading-relaxed max-w-xl mx-auto">
          Unlock the ability to forge customized premium keys, set specific validities, and completely rebrand gift vouchers. Distribute them to your audience and monetize your influence with our enterprise-grade reseller tools.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 pb-2">
          <div className="glass p-5 rounded-2xl border border-white/5 bg-white/[0.02]">
            <Sparkles className="h-6 w-6 text-indigo-400 mx-auto mb-3" />
            <h4 className="text-xs font-black text-white uppercase tracking-widest mb-2">Rebrandable</h4>
            <p className="text-[10px] text-muted-foreground">Customize voucher codes to match your brand.</p>
          </div>
          <div className="glass p-5 rounded-2xl border border-white/5 bg-white/[0.02]">
            <Globe className="h-6 w-6 text-purple-400 mx-auto mb-3" />
            <h4 className="text-xs font-black text-white uppercase tracking-widest mb-2">Global Reach</h4>
            <p className="text-[10px] text-muted-foreground">Sell globally without infra worries.</p>
          </div>
          <div className="glass p-5 rounded-2xl border border-white/5 bg-white/[0.02]">
            <RefreshCw className="h-6 w-6 text-emerald-400 mx-auto mb-3" />
            <h4 className="text-xs font-black text-white uppercase tracking-widest mb-2">Recurring</h4>
            <p className="text-[10px] text-muted-foreground">Build steady income through renewals.</p>
          </div>
        </div>

        <button
          onClick={() => window.open('https://discord.gg/4RdMhcYws', '_blank')}
          className="mx-auto flex items-center justify-center space-x-2 px-8 py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(99,102,241,0.3)] hover:shadow-[0_0_40px_rgba(99,102,241,0.5)] border border-indigo-400/20 hover:-translate-y-1 duration-300"
        >
          <span>Apply for Reseller Tier</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ResellerTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const { data: session } = useSession()
  const user = (session?.user as any) || {}
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return <BecomeReseller />
  }

  // Affiliate Dashboard States
  const [generating, setGenerating] = useState(false)
  const [campaignName, setCampaignName] = useState('')
  const [affiliateLinks, setAffiliateLinks] = useState<any[]>([
    { id: '1', code: 'WINTER26', clicks: 1204, conversions: 45, revenue: 890.50, active: true },
    { id: '2', code: 'YOUTUBE_PROMO', clicks: 8530, conversions: 210, revenue: 4200.00, active: true }
  ])

  const generateLink = async () => {
    if (!campaignName.trim()) return
    setGenerating(true)
    
    // Simulate API call for generating an affiliate link
    setTimeout(() => {
      setAffiliateLinks(prev => [{
        id: Math.random().toString(),
        code: campaignName.trim().toUpperCase().replace(/\s+/g, '_'),
        clicks: 0,
        conversions: 0,
        revenue: 0,
        active: true
      }, ...prev])
      toastSuccess('Link Generated', 'Your new tracking link is ready.')
      setCampaignName('')
      setGenerating(false)
    }, 800)
  }

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`https://gg.com/ref/${code}`)
    toastSuccess('Copied', 'Tracking link copied to clipboard.')
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
        <div className="absolute -inset-x-6 -inset-y-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent blur-2xl -z-10 rounded-full" />
        <div>
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-emerald-200 flex items-center space-x-3 tracking-tight">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <TrendingUp className="h-6 w-6 text-emerald-400" />
            </div>
            <span>Affiliate & Referral Hub</span>
          </h2>
          <p className="text-sm text-emerald-200/60 mt-2 font-medium">Generate tracking links, monitor conversions, and claim your commissions.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Creator panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass rounded-[2rem] p-6 space-y-5 border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent relative overflow-hidden group shadow-[0_0_30px_rgba(16,185,129,0.05)]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full blur-2xl group-hover:bg-emerald-500/20 transition-colors duration-700" />
            
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center space-x-2 relative z-10">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span>New Campaign Link</span>
            </h3>
            
            <div className="space-y-5 relative z-10">
              <div className="space-y-1.5 group/input">
                <label className="text-[10px] uppercase font-bold text-emerald-200/70 tracking-widest">Custom Tracking ID</label>
                <div className="relative">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 rounded-xl blur opacity-0 group-hover/input:opacity-100 transition duration-500" />
                  <input
                    type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
                    placeholder="e.g. SUMMER_SALE"
                    className="relative w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none shadow-inner backdrop-blur-xl focus:border-emerald-500/50 transition-colors uppercase font-mono"
                  />
                </div>
              </div>

              <button
                onClick={generateLink} disabled={generating || !campaignName.trim()}
                className="w-full flex items-center justify-center space-x-2 px-6 py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] border border-emerald-400/20 hover:-translate-y-0.5 duration-300 mt-2"
              >
                {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                <span>{generating ? 'Generating...' : 'Create Link'}</span>
              </button>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent relative overflow-hidden group shadow-[0_0_30px_rgba(245,158,11,0.05)] text-center">
            <h3 className="text-[10px] font-black text-amber-400/80 uppercase tracking-widest mb-2">Available Balance</h3>
            <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-amber-200 tracking-tighter mb-4">
              $1,240.50
            </p>
            <button className="w-full py-3 bg-white/5 hover:bg-amber-500/20 border border-white/10 hover:border-amber-500/40 rounded-xl text-xs font-black uppercase tracking-widest text-amber-400 transition-all">
              Request Payout
            </button>
          </div>
        </div>

        {/* Analytics panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass rounded-2xl p-5 border border-white/5 bg-white/[0.02]">
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-blue-500/10 rounded-lg"><MousePointer2 className="h-4 w-4 text-blue-400" /></div>
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Total Clicks</h4>
              </div>
              <p className="text-2xl font-black text-white">9,734</p>
            </div>
            <div className="glass rounded-2xl p-5 border border-white/5 bg-white/[0.02]">
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-emerald-500/10 rounded-lg"><UserPlus className="h-4 w-4 text-emerald-400" /></div>
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Conversions</h4>
              </div>
              <p className="text-2xl font-black text-white">255</p>
            </div>
            <div className="glass rounded-2xl p-5 border border-white/5 bg-white/[0.02]">
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-amber-500/10 rounded-lg"><DollarSign className="h-4 w-4 text-amber-400" /></div>
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">All Time Earned</h4>
              </div>
              <p className="text-2xl font-black text-white">$5,090.50</p>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-8 min-h-[400px] border border-white/5 bg-black/20 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            
            <h3 className="text-xs font-black text-white uppercase tracking-widest mb-6 opacity-80 flex items-center space-x-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <span>Active Campaigns</span>
            </h3>
            
            <div className="space-y-4">
              {affiliateLinks.map(link => (
                <div key={link.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-white/[0.02] rounded-2xl border border-white/5 hover:border-emerald-500/30 hover:bg-white/[0.04] transition-all duration-300 group relative overflow-hidden">
                  <div className="absolute left-0 inset-y-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="flex items-center space-x-5 pl-2 relative z-10">
                    <div className="min-w-0">
                      <p className="text-base font-mono font-black text-white/90 group-hover:text-white truncate tracking-tight transition-colors">gg.com/ref/{link.code}</p>
                      <div className="flex items-center space-x-4 mt-1.5">
                        <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                          <MousePointer2 className="h-3 w-3" /> {link.clicks} clicks
                        </span>
                        <span className="text-[10px] font-medium text-emerald-400/80 flex items-center gap-1">
                          <UserPlus className="h-3 w-3" /> {link.conversions} joins
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 sm:mt-0 flex items-center justify-between sm:justify-end space-x-8 relative z-10">
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Generated Rev</p>
                      <p className="text-sm font-black text-emerald-300">${link.revenue.toFixed(2)}</p>
                    </div>
                    
                    <button
                      onClick={() => copyLink(link.code)}
                      className="p-2.5 rounded-xl border border-transparent bg-black/40 text-muted-foreground hover:text-white hover:border-white/10 hover:bg-white/5 transition-all duration-300 group/btn"
                      title="Copy Link"
                    >
                      <Copy className="h-4 w-4 group-hover/btn:scale-110 transition-transform" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DonationsTab() {
  const [donations, setDonations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Game Search States
  const [gameList, setGameList] = useState<{ name: string, appId: number }[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedGame, setSelectedGame] = useState<{ name: string, appId: number } | null>(null)
  const [steamKey, setSteamKey] = useState('')
  const [filteredGames, setFilteredGames] = useState<{ name: string, appId: number }[]>([])
  const [showDropdown, setShowDropdown] = useState(false)

  const { success: toastSuccess, error: toastError } = useToast()

  const loadDonations = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/donations')
      if (res.ok) {
        const d = await res.json()
        setDonations(d.donations || [])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadGameList = async () => {
    try {
      const resp = await fetch('/api/bots/discord/admin?action=get_games')
      if (resp.ok) {
        const data = await resp.json()
        setGameList(data.games || [])
      }
    } catch (e) { console.error('Failed to load list') }
  }

  useEffect(() => {
    loadDonations()
    loadGameList()
  }, [])

  useEffect(() => {
    if (searchTerm.length > 1) {
      const filtered = gameList
        .filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, 10)
      setFilteredGames(filtered)
    } else {
      setFilteredGames([])
    }
  }, [searchTerm, gameList])

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.game-select-container')) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const submitDonation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGame || !steamKey) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/user/donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: selectedGame.name, steamKey })
      })

      if (res.ok) {
        toastSuccess('Donation Submitted', `Your donation for ${selectedGame.name} is now pending approval.`)
        setSelectedGame(null)
        setSearchTerm('')
        setSteamKey('')
        loadDonations()
      } else {
        toastError('Submission Failed', 'Please check your inputs and try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* ── Donation Form Banner ─────────────────────────────────────────────── */}
      <div className="glass !border-indigo-500/20 !bg-indigo-500/5 rounded-[2.5rem] p-8 md:p-10 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[100px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-8">
          <div className="max-w-md space-y-4">
            <div className="inline-flex items-center space-x-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
              <Star className="h-3 w-3 text-indigo-400 fill-indigo-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-300">New Contribution</span>
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight leading-none italic">
              Level Up Our <span className="text-indigo-400 underline decoration-indigo-500/30">Library</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Don't have a Discord? You can now submit Steam keys directly from the dashboard. All donations go through staff audit.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={submitDonation} className="flex-1 w-full max-w-lg space-y-4">
            <div className="relative group game-select-container">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                {selectedGame ? (
                  <CheckCircle className="h-5 w-5 text-emerald-400 animate-in zoom-in" />
                ) : (
                  <Search className="h-5 w-5 text-indigo-500/50 group-hover:text-indigo-400 transition-colors" />
                )}
              </div>
              <input
                type="text"
                autoComplete="off"
                value={selectedGame ? selectedGame.name : searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setShowDropdown(true)
                  if (selectedGame) setSelectedGame(null)
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Game name (e.g. Elden Ring)"
                className={`w-full bg-black/40 border-2 rounded-2xl py-4 pl-12 pr-12 text-sm transition-all focus:ring-4 focus:ring-indigo-500/10 outline-none ${
                  selectedGame 
                    ? 'border-emerald-500/30 text-emerald-100 font-bold' 
                    : 'border-white/5 text-white placeholder-white/20 focus:border-indigo-500/50'
                }`}
                required
              />
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                <ChevronDown className={`h-5 w-5 text-white/20 transition-transform duration-300 ${showDropdown ? 'rotate-180 text-indigo-400' : ''}`} />
              </div>

              {showDropdown && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#0A0A0B] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  {filteredGames.length > 0 ? (
                    filteredGames.map(g => (
                      <button
                        key={g.appId}
                        type="button"
                        onClick={() => { setSelectedGame(g); setShowDropdown(false); setSearchTerm(''); }}
                        className="w-full text-left px-5 py-3 text-xs font-bold text-white/70 hover:bg-indigo-500 hover:text-white transition-all flex items-center justify-between group/item border-b border-white/5 last:border-0"
                      >
                        <span className="truncate">{g.name}</span>
                        <span className="text-[10px] font-mono text-white/20 group-hover/item:text-white/50">{g.appId}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-5 py-6 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/20">
                        {searchTerm.length < 2 ? 'Type at least 2 characters...' : 'No matching games found'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative group flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-indigo-500/50 group-hover:text-indigo-400 transition-colors" />
                </div>
                <input
                  type="text"
                  value={steamKey}
                  onChange={(e) => setSteamKey(e.target.value.toUpperCase())}
                  placeholder="AAAAA-BBBBB-CCCCC"
                  className="w-full bg-black/40 border-2 border-white/5 rounded-2xl py-4 pl-12 pr-6 text-sm text-indigo-300 placeholder-white/20 focus:border-indigo-500/50 outline-none transition-all font-mono tracking-widest"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !selectedGame || !steamKey}
                className="shrink-0 px-8 py-4 bg-white hover:bg-indigo-50 text-black font-black uppercase tracking-widest text-xs rounded-2xl transition-all shadow-xl shadow-white/5 disabled:opacity-30 disabled:grayscale hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center space-x-2"
              >
                {submitting ? <Activity className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>Donate</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── History List ─────────────────────────────────────────────────── */}
      <div className="glass rounded-[2rem] p-8 md:p-10 border border-white/10 space-y-8 shadow-2xl">
        <div className="flex items-center justify-between pb-6 border-b border-white/5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center space-x-3">
              <TrendingUp className="h-5 w-5 text-indigo-400" />
              <span>Personal Tracking</span>
            </h2>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-1">Status of your prior submissions</p>
          </div>
          <button
            onClick={loadDonations}
            className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-white/30 hover:text-white transition-all outline-none"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="py-24 text-center">
              <Activity className="h-8 w-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground font-black uppercase tracking-widest text-[10px]/relaxed animate-pulse">Syncing donation ledger...</p>
            </div>
          ) : donations.length === 0 ? (
            <div className="py-24 text-center bg-white/5 border-2 border-dashed border-white/10 rounded-3xl group">
              <div className="p-5 bg-white/5 rounded-full w-fit mx-auto mb-4 border border-white/10 group-hover:border-indigo-500/30 transition-all">
                <Heart className="h-10 w-10 text-white/5 group-hover:text-indigo-500/30 transition-all" />
              </div>
              <p className="text-xl font-bold text-white/40 mb-2">The hero's journey begins with the first key.</p>
              <p className="text-xs text-muted-foreground px-6 font-medium">Use the contribution box above to make your first donation.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {donations.map(d => (
                <div key={d.id} className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-5 relative overflow-hidden group hover:bg-white/[0.08] hover:border-indigo-500/30 transition-all duration-300">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-[40px] rounded-full pointer-events-none" />

                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center space-x-4">
                      <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 group-hover:scale-110 transition-transform">
                        <Gamepad2 className="h-6 w-6 text-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.3)]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-bold text-white truncate max-w-[200px] leading-tight">{d.gameName}</p>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mt-1">{new Date(d.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border shadow-sm ${d.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/5' :
                        d.status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border-red-500/20 shadow-red-500/5' :
                          'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse shadow-amber-500/5'
                      }`}>
                      {d.status}
                    </div>
                  </div>

                  <div className="space-y-4 relative z-10 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Registered Key</span>
                      <div className="flex items-center space-x-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-indigo-500/50" />
                        <span className="font-mono text-xs text-indigo-300 group-hover:text-indigo-200 transition-colors uppercase tracking-widest">
                          {d.status === 'PENDING' ? d.steamKey : 'CONFIRMED'}
                        </span>
                      </div>
                    </div>

                    {d.notes && (
                      <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 animate-in slide-in-from-top-2">
                        <div className="flex items-center space-x-2 mb-2">
                          <Activity className="h-3.5 w-3.5 text-indigo-400" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Staff Insights</span>
                        </div>
                        <p className="text-[11px] text-white/80 italic leading-relaxed font-medium">"{d.notes}"</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Guides Tab ───────────────────────────────────────────────────────────────
function GuidesTab() {
  const [activeGuide, setActiveGuide] = useState<string | null>(null)

  const GUIDES = [
    {
      id: 'handbook',
      title: 'Moderator Handbook',
      description: 'Complete guide for OpenSteam moderators — rules, procedures, and best practices.',
      icon: <BookOpen className="h-6 w-6" />,
      embedUrl: 'https://docs.google.com/document/d/1ZTLsqqYVtnbZL_0YRiBaf4-06nkJLoeKk65CnsYCT1U/preview',
    },
    {
      id: 'pa_director',
      title: 'Personal Assistant of Director',
      description: 'Guidelines and responsibilities for the Personal Assistant of the Director.',
      icon: <BookOpen className="h-6 w-6" />,
      embedUrl: 'https://docs.google.com/document/d/1kkfKlbNohuBIraaEG7yoSyeZi8KCApk818uo__RpC00/preview',
    },
    {
      id: 'exec_officer',
      title: 'Executive Officer',
      description: 'Guidelines and responsibilities for the Executive Officer.',
      icon: <BookOpen className="h-6 w-6" />,
      embedUrl: 'https://docs.google.com/document/d/1whgUEf0Sn98eCOORwcfqbaTUjATNaB2AlGWysWP_u9w/preview',
    }
  ]

  if (activeGuide) {
    const guide = GUIDES.find(g => g.id === activeGuide)
    if (!guide) return null
    return (
      <div className="glass rounded-3xl overflow-hidden animate-in fade-in slide-in-from-bottom-4" style={{ height: 'calc(100vh - 200px)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30 text-indigo-400">{guide.icon}</div>
            <div>
              <h2 className="text-sm font-bold text-white">{guide.title}</h2>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Staff Resource</p>
            </div>
          </div>
          <button onClick={() => setActiveGuide(null)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all">← Back</button>
        </div>
        <iframe src={guide.embedUrl} className="w-full border-0" style={{ height: 'calc(100% - 65px)' }} allowFullScreen />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="glass rounded-3xl p-6 sm:p-8">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30"><BookOpen className="h-6 w-6 text-indigo-400" /></div>
          <div>
            <h2 className="text-xl font-bold text-white">Staff Guides</h2>
            <p className="text-sm text-muted-foreground">Essential reading for all moderators and staff members.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {GUIDES.map(guide => (
            <button key={guide.id} onClick={() => setActiveGuide(guide.id)} className="flex items-start space-x-4 p-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-indigo-500/30 transition-all text-left group">
              <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0 group-hover:bg-indigo-500/20 transition-colors">{guide.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white mb-1">{guide.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{guide.description}</p>
                <div className="flex items-center space-x-2 mt-3">
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">Google Docs</span>
                  <span className="text-[9px] text-muted-foreground">Opens inline</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-indigo-400 shrink-0 mt-1 group-hover:translate-x-1 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Tests Tab (All Staff) ────────────────────────────────────────────────────
function TestsTab({ userRole }: { userRole: string }) {
  const router = useRouter()
  const isAdmin = userRole === 'ADMIN' || userRole === 'OWNER'
  const canRunTrialCron = isAdmin || userRole === 'SENIOR_MODERATOR'
  const isTrial = userRole === 'TRIAL_MODERATOR'
  const [trialTest, setTrialTest] = useState<any>(null)
  const [testAnswers, setTestAnswers] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [testResult, setTestResult] = useState<any>(null)
  const [trialMods, setTrialMods] = useState<any[]>([])
  const [selectedModId, setSelectedModId] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [liveModAssessmentEligible, setLiveModAssessmentEligible] = useState<boolean | null>(null)
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast()

  const loadLiveAssessmentEligibility = useCallback(async () => {
    try {
      const res = await fetch('/api/mod-assessment', { cache: 'no-store' })
      const d = res.ok ? await res.json() : {}
      setLiveModAssessmentEligible(Boolean(d.eligible))
    } catch {
      setLiveModAssessmentEligible(false)
    }
  }, [])

  const loadTest = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch('/api/admin/trial/test')
      if (res.ok) {
        const data = await res.json()
        const t = data.test && data.test.examKind === 'live' ? null : data.test
        if (t) {
          setTrialTest(t)
          if (t.status === 'ACTIVE') {
            const n = (t.questions as any[]).length
            setTestAnswers((prev) => {
              if (prev.length === n) return prev
              return new Array(n).fill(-1)
            })
          }
        } else {
          setTrialTest(null)
          setTestAnswers([])
        }
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  const loadModTest = useCallback(async (userId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setSelectedModId(userId)
      setTrialTest(null)
      setLoading(true)
    }
    try {
      const res = await fetch(`/api/admin/trial/test?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        const t = data.test && data.test.examKind === 'live' ? null : data.test
        setTrialTest(t ?? null)
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  const loadTrialMods = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch('/api/admin/trial')
      if (res.ok) {
        const data = await res.json()
        setTrialMods(data.trialMods || [])
        if (!opts?.silent && data.trialMods?.length > 0 && !selectedModId) {
          const first = data.trialMods[0].id
          setSelectedModId(first)
          void loadModTest(first)
        }
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [selectedModId, loadModTest])

  useEffect(() => {
    if (canRunTrialCron) {
      fetch('/api/admin/trial/cron?internal=1').catch(() => {})
    }
    if (isTrial) {
      void loadTest()
      void loadLiveAssessmentEligibility()
    }
    if (isAdmin) {
      void loadTrialMods()
    }
    if (!isTrial && !isAdmin) setLoading(false)
  }, [canRunTrialCron, isTrial, isAdmin, loadTest, loadLiveAssessmentEligibility, loadTrialMods])

  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      if (isTrial) {
        void loadTest({ silent: true })
        void loadLiveAssessmentEligibility()
      }
      if (isAdmin) {
        void loadTrialMods({ silent: true })
        if (selectedModId) void loadModTest(selectedModId, { silent: true })
      }
    }
    const id = window.setInterval(tick, DASHBOARD_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isTrial, isAdmin, selectedModId, loadTest, loadLiveAssessmentEligibility, loadTrialMods, loadModTest])

  const submitTest = async () => {
    if (!trialTest || testAnswers.includes(-1)) {
      toastError('Incomplete', 'Please answer all questions before submitting.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/trial/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', testId: trialTest.id, answers: testAnswers })
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult(data)
        data.passed ? toastSuccess('Congratulations!', `You passed with ${data.score}/${data.maxScore}!`) : toastError('Test Failed', `Score: ${data.score}/${data.maxScore}. You may appeal.`)
      } else { toastError('Error', data.error) }
    } finally { setLoading(false) }
  }

  const appealTest = async () => {
    if (!trialTest) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/trial/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'appeal', testId: trialTest.id })
      })
      const data = await res.json()
      if (res.ok) { toastSuccess('Appeal Submitted', data.message); void loadTest() }
      else { toastError('Error', data.error) }
    } finally { setLoading(false) }
  }

  const resendAllTrialWelcomeDms = async () => {
    if (!confirm('Send the trial moderator welcome DM to every user who currently has the Trial Moderator role? Success is recorded in the database.')) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend_trial_welcome_dms' }),
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess(
          'Welcome DMs',
          `Sent: ${data.counts?.delivered ?? 0} · Failed: ${data.counts?.failed ?? 0} · Total: ${data.counts?.total ?? 0}`,
        )
        void loadTrialMods()
        if (selectedModId) void loadModTest(selectedModId)
      } else {
        toastError('Error', data.error || 'Request failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const regenTest = async (userId: string) => {
    if (!confirm('This will delete the current test and generate a new one. Continue?')) return
    setLoading(true)
    try {
      // Delete existing test first if any
      if (trialTest) {
        await fetch('/api/admin/trial', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'override_fail', testId: trialTest.id, notes: 'Test regenerated by admin' })
        })
      }
      const res = await fetch('/api/admin/trial/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Test Regenerated', `New test with ${data.questionCount} questions created.`)
        loadModTest(userId)
      } else { toastError('Error', data.error) }
    } finally { setLoading(false) }
  }

  const overrideResult = async (action: 'override_pass' | 'override_fail') => {
    if (!trialTest) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/trial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, testId: trialTest.id, notes: adminNotes, userId: trialTest.userId })
      })
      if (res.ok) {
        toastSuccess('Override Applied', action === 'override_pass' ? 'Marked as passed.' : 'Marked as failed.')
        setAdminNotes('')
        if (selectedModId) void loadModTest(selectedModId)
        void loadTrialMods()
      } else {
        const data = await res.json()
        toastError('Error', data.error)
      }
    } finally { setLoading(false) }
  }

  const statusLabel = (s: string) => ({ PENDING: 'Pending', ACTIVE: 'Ready to Take', SUBMITTED: 'Grading...', AWAITING_STAFF: 'Awaiting staff', PASSED: 'Passed ✅', FAILED: 'Failed ❌', APPEALED: 'Under Review', OVERRIDE_PASS: 'Passed (Override) ✅', OVERRIDE_FAIL: 'Failed (Admin) ❌' }[s] || s)
  const statusColor = (s: string) => ['PASSED', 'OVERRIDE_PASS'].includes(s) ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : ['FAILED', 'OVERRIDE_FAIL'].includes(s) ? 'text-red-400 bg-red-500/10 border-red-500/20' : s === 'ACTIVE' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="glass rounded-3xl p-6 sm:p-8">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-amber-500/20 rounded-2xl border border-amber-500/30"><FileText className="h-6 w-6 text-amber-400" /></div>
          <div>
            <h2 className="text-xl font-bold text-white">{isAdmin ? 'Staff Exam Management' : 'Trial Moderator Tests'}</h2>
            <p className="text-sm text-muted-foreground">{isAdmin ? 'Review trial, promotion, and executive exam submissions.' : isTrial ? 'Complete your evaluation to become a full Moderator. You need 70% to pass.' : 'Overview of the trial moderator evaluation system.'}</p>
          </div>
        </div>

        {/* Admin: Trial Mod List */}
        {isAdmin && (
          <div className="space-y-4">
            {trialMods.length === 0 && !loading && (
              <div className="text-center py-12 bg-white/5 border border-dashed border-white/10 rounded-2xl">
                <Users className="h-8 w-8 text-white/10 mx-auto mb-3" />
                <p className="text-sm font-semibold text-white">No Trial Moderators</p>
                <p className="text-xs text-muted-foreground mt-1">Promote a user to Trial Moderator from the Admin Panel to see them here.</p>
              </div>
            )}
            {trialMods.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
                <p className="text-xs text-muted-foreground max-w-prose">
                  <span className="text-white/90 font-semibold">Welcome DM</span> — The timestamp below is updated when the bot successfully delivers the trial welcome message. Resend to everyone with the current role if someone missed it.
                </p>
                <button
                  type="button"
                  onClick={resendAllTrialWelcomeDms}
                  disabled={loading}
                  className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  <Mail className="h-4 w-4" />
                  Resend to all
                </button>
              </div>
            )}
            {trialMods.length > 0 && (
              <div className="grid gap-3">
                {trialMods.map((mod: any) => {
                  const modAv = getDiscordCdnAvatarUrl(mod.discordId, mod.avatar, 64)
                  return (
                  <div key={mod.id}
                    className={`rounded-2xl border transition-all overflow-hidden ${selectedModId === mod.id ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-white/5 border-white/10'}`}>
                    <button type="button" onClick={() => loadModTest(mod.id)}
                      className="flex items-center justify-between p-4 w-full text-left hover:bg-white/5 transition-colors">
                      <div className="flex items-center space-x-3 min-w-0">
                        {modAv ? (
                          <img src={modAv} className="h-8 w-8 rounded-full shrink-0" alt="" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold shrink-0">{(mod.username || '?')[0]}</div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{mod.username}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {mod.daysRemaining} days remaining • Started {mod.trialStartDate ? new Date(mod.trialStartDate).toLocaleDateString() : 'N/A'}
                            {mod.trialWelcomeDmDeliveredAt
                              ? ` • Welcome DM ${new Date(mod.trialWelcomeDmDeliveredAt).toLocaleString()}`
                              : ' • Welcome DM not recorded'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border shrink-0 ml-2 ${
                          mod.modTestReadyAt
                            ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
                            : mod.latestTest
                              ? statusColor(mod.latestTest.status)
                              : 'text-white/30 bg-white/5 border-white/10'
                        }`}
                      >
                        {mod.modTestReadyAt
                          ? 'Live ready'
                          : mod.latestTest
                            ? statusLabel(mod.latestTest.status)
                            : 'No Test'}
                      </span>
                    </button>
                    <div className="px-4 pb-3 pl-[3.75rem]" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                      <TrialModControls
                        userId={mod.id}
                        discordId={mod.discordId ?? null}
                        trialModEndsAtIso={mod.trialModEndsAt ? new Date(mod.trialModEndsAt).toISOString() : null}
                        modTestReadyAtIso={mod.modTestReadyAt ? new Date(mod.modTestReadyAt).toISOString() : null}
                        onApplied={(p) => {
                          void loadTrialMods()
                          if (!p.ok) return
                          if (p.action === 'release-test') {
                            const notifyParts: string[] = ['Candidate can open /dashboard/mod-assessment.']
                            if (p.dmSent) {
                              notifyParts.push(
                                p.dmTokenUsed === 'backup'
                                  ? 'Discord DM sent via backup bot.'
                                  : 'Discord DM sent.'
                              )
                            } else if (p.dmSkipped) {
                              notifyParts.push('No Discord ID — notify manually or rely on email.')
                            } else {
                              notifyParts.push('Discord DM failed — ping the user manually.')
                              if (p.dmWarning) notifyParts.push(p.dmWarning)
                            }
                            if (p.emailSent) notifyParts.push('Email notification sent.')

                            if (p.dmSent || p.dmSkipped || p.emailSent) {
                              toastSuccess('Assessment unlocked', notifyParts.join(' '))
                            } else {
                              toastWarning('Assessment unlocked — notifications failed', notifyParts.join(' '))
                            }
                          } else if (p.action === 'start') {
                            toastSuccess('Trial scheduled', `${TRIAL_MOD_DAYS}-day window started.`)
                          } else if (p.action === 'clear') {
                            toastSuccess('Trial state cleared', 'Live flags reset for this user.')
                          }
                        }}
                      />
                    </div>
                  </div>
                )
                })}
              </div>
            )}
            {isAdmin && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 mt-2">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-200 mb-1">Staff exam attempts</h3>
                <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed max-w-prose">
                  Admins/owners can open a preview (questions + answer keys + any autosaved answers) and download staff or blank PDFs as soon as the attempt row exists — before the candidate submits.
                </p>
                <ModAttemptsTable />
              </div>
            )}
          </div>
        )}

        {/* Executive Officer exam (Head Moderator → Executive Officer) — highest rank; shown first */}
        <ExecutiveTestCard />

        {/* Promotional rank exam (Moderator → Senior → Head) — hidden when executive track applies */}
        <PromoTestCard />

        {/* Admin: manually force days-on-team (tenure) for promotion eligibility */}
        {isAdmin && <PromoTenureControls />}

        {/* Trial Mod: Timeline */}
        {isTrial && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-white/5 rounded-2xl border border-white/10 text-center">
              <BookOpen className="h-5 w-5 text-indigo-400 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Step 1</p>
              <p className="text-xs text-white font-semibold mt-1">Read Handbook</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Study the guides</p>
            </div>
            <div className={`p-4 rounded-2xl border text-center ${trialTest ? 'bg-amber-500/10 border-amber-500/20' : 'bg-white/5 border-white/10'}`}>
              <FileText className="h-5 w-5 text-amber-400 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Step 2</p>
              <p className="text-xs text-white font-semibold mt-1">Take Test</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                {trialTest ? 'Unlocked below or use Moderator assessment' : `Staff may release anytime (ends after ${TRIAL_MOD_DAYS}d trial)`}
              </p>
            </div>
            <div className={`p-4 rounded-2xl border text-center ${testResult?.passed || trialTest?.status === 'PASSED' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10'}`}>
              <CheckCircle className="h-5 w-5 text-emerald-400 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Step 3</p>
              <p className="text-xs text-white font-semibold mt-1">Graduate</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Become full Moderator</p>
            </div>
          </div>
        )}

        {/* Moderator: Read-only info */}
        {!isTrial && !isAdmin && (
          <div className="text-center py-8 bg-white/5 border border-dashed border-white/10 rounded-2xl">
            <Shield className="h-8 w-8 text-indigo-400/30 mx-auto mb-3" />
            <p className="text-sm font-semibold text-white">Trial Evaluation System</p>
            <p className="text-xs text-muted-foreground mt-1">
              Trial Moderators complete a handbook-based evaluation ({TRIAL_MOD_DAYS}-day trial). Staff may release the live assessment immediately via dashboard controls — or older auto-generated tests appear here when cron runs near trial end.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && !trialTest && trialMods.length === 0 && (
          <div className="text-center py-12"><Activity className="h-6 w-6 text-indigo-500 animate-spin mx-auto mb-2" /><p className="text-sm text-muted-foreground">Loading...</p></div>
        )}

        {/* Trial Mod: live assessment takes priority over legacy handbook test */}
        {isTrial && !loading && liveModAssessmentEligible && (
          <div className="text-center py-10 px-6 bg-amber-500/10 border border-amber-500/25 rounded-2xl">
            <Sparkles className="h-8 w-8 text-amber-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-white">Moderator assessment is ready</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
              Staff unlocked your exam. Open <strong>/dashboard/mod-assessment</strong>: 20 A–D + 10 written answers, fullscreen, paused if you leave the tab. Groq-assisted grading, then staff review.
            </p>
            <button
              type="button"
              onClick={() => router.push('/dashboard/mod-assessment')}
              className="mt-5 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 transition-colors"
            >
              Open moderator assessment
            </button>
          </div>
        )}

        {isTrial && !loading && liveModAssessmentEligible === null && !trialTest && (
          <div className="text-center py-8 text-muted-foreground text-sm"><Activity className="h-5 w-5 inline animate-spin mr-2" />Checking moderator assessment…</div>
        )}

        {isTrial && !loading && !liveModAssessmentEligible && !trialTest && (
          <div className="text-center py-12 bg-white/5 border border-dashed border-white/10 rounded-2xl">
            <Clock className="h-8 w-8 text-white/10 mx-auto mb-3" />
            <p className="text-sm font-semibold text-white">Test Not Yet Available</p>
            <p className="text-xs text-muted-foreground mt-1">
              Your live assessment unlocks when staff releases it — you&apos;ll get a Discord DM with a link to <strong>/dashboard/mod-assessment</strong>. Handbook: Guides — trial defaults to{' '}
              <strong>{TRIAL_MOD_DAYS} days</strong>.
            </p>
          </div>
        )}

        {/* Test status card (Trial Mod + Admin with selected mod) — legacy handbook only when live is not unlocked */}
        {trialTest && !(isTrial && liveModAssessmentEligible) && (
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10">
              <div className="flex items-center space-x-3">
                <FileText className="h-5 w-5 text-amber-400" />
                <div>
                  <p className="text-sm font-bold text-white">Handbook Evaluation {trialTest.user ? `— ${trialTest.user.username}` : ''}</p>
                  <p className="text-[10px] text-muted-foreground">{(trialTest.questions as any[]).length} questions • 70% to pass{trialTest.score != null ? ` • Score: ${trialTest.score}/${trialTest.maxScore}` : ''}</p>
                </div>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${statusColor(trialTest.status)}`}>{statusLabel(trialTest.status)}</span>
            </div>
            {trialTest.expiresAt && trialTest.status === 'ACTIVE' && (
              <p className="text-[10px] text-amber-400 font-bold text-center">⏰ Deadline: {new Date(trialTest.expiresAt).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
            )}
          </div>
        )}
      </div>

      {/* Admin: Test Viewer + Controls */}
      {isAdmin && trialTest && selectedModId && (
        <div className="glass rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Test Details</h3>
            <div className="flex items-center space-x-2">
              <button onClick={() => regenTest(selectedModId)} disabled={loading}
                className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center space-x-1.5">
                <RefreshCw className="h-3.5 w-3.5" /><span>Regenerate Test</span>
              </button>
            </div>
          </div>

          {/* Show questions with correct answers highlighted */}
          {(trialTest.questions as any[]).map((q: any, qi: number) => (
            <div key={qi} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
              <div className="flex items-center space-x-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">{q.section}</span>
                <span className="text-[9px] font-black text-white/30 uppercase">Q{qi + 1}</span>
              </div>
              <p className="text-sm font-semibold text-white">{q.question}</p>
              <div className="grid gap-1.5">
                {(q.options as string[]).map((opt: string, oi: number) => {
                  const isCorrect = q.correctIndex === oi
                  const userAnswer = trialTest.answers ? (trialTest.answers as number[])[qi] : undefined
                  const isUserAnswer = userAnswer === oi
                  return (
                    <div key={oi} className={`px-3 py-2 rounded-lg text-xs border ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : isUserAnswer && !isCorrect ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-white/[0.02] border-white/5 text-white/50'}`}>
                      <span className="font-mono text-[10px] mr-1.5">{String.fromCharCode(65 + oi)}.</span>
                      {opt}
                      {isCorrect && <span className="ml-2 text-[9px] font-black text-emerald-400">✓ CORRECT</span>}
                      {isUserAnswer && !isCorrect && <span className="ml-2 text-[9px] font-black text-red-400">✗ SELECTED</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Admin Override Controls */}
          <div className="border-t border-white/10 pt-6 space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-red-400">Admin Override</h4>
            <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Admin notes (optional)..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none h-20" />
            <div className="flex space-x-3">
              <button onClick={() => overrideResult('override_pass')} disabled={loading}
                className="flex-1 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5">
                <CheckCircle className="h-3.5 w-3.5" /><span>Override: Pass</span>
              </button>
              <button onClick={() => overrideResult('override_fail')} disabled={loading}
                className="flex-1 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5">
                <AlertCircle className="h-3.5 w-3.5" /><span>Override: Fail</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && selectedModId && !trialTest && (
        <div className="glass rounded-3xl p-6 sm:p-8 border border-white/10 border-dashed">
          <p className="text-xs text-white/60">
            No handbook MCQ test for this moderator (or they use the live moderator assessment only). Use the live assessment table below for live exams.
          </p>
        </div>
      )}

      {/* Trial Mod: Active Test Questions */}
      {isTrial && trialTest && trialTest.status === 'ACTIVE' && !testResult && !liveModAssessmentEligible && (
        <div className="glass rounded-3xl p-6 sm:p-8 space-y-6">
          {(trialTest.questions as any[]).map((q: any, qi: number) => (
            <div key={qi} className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center space-x-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">{q.section}</span>
                <span className="text-[9px] font-black text-white/30 uppercase">Q{qi + 1}</span>
              </div>
              <p className="text-sm font-semibold text-white">{q.question}</p>
              <div className="grid gap-2">
                {(q.options as string[]).map((opt: string, oi: number) => (
                  <button key={oi} onClick={() => { const a = [...testAnswers]; a[qi] = oi; setTestAnswers(a) }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all border ${testAnswers[qi] === oi ? 'bg-indigo-500/20 border-indigo-500/40 text-white font-medium' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'}`}>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{String.fromCharCode(65 + oi)}.</span>{opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            <p className="text-xs text-muted-foreground">{testAnswers.filter(a => a !== -1).length}/{(trialTest.questions as any[]).length} answered</p>
            <button onClick={submitTest} disabled={loading || testAnswers.includes(-1)} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center space-x-2">
              {loading ? <Activity className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span>Submit Test</span>
            </button>
          </div>
        </div>
      )}

      {/* Trial Mod: Results */}
      {isTrial && (testResult || (trialTest && ['PASSED', 'FAILED', 'APPEALED', 'OVERRIDE_PASS', 'OVERRIDE_FAIL'].includes(trialTest.status))) && (
        <div className="glass rounded-3xl p-6 sm:p-8 space-y-4">
          <div className={`p-6 rounded-2xl border ${(testResult?.passed || trialTest?.status === 'PASSED' || trialTest?.status === 'OVERRIDE_PASS') ? 'bg-emerald-500/10 border-emerald-500/20' : trialTest?.status === 'APPEALED' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
            <div className="flex items-center space-x-2 mb-2">
              {(testResult?.passed || trialTest?.status === 'PASSED' || trialTest?.status === 'OVERRIDE_PASS') ? <CheckCircle className="h-5 w-5 text-emerald-400" /> : trialTest?.status === 'APPEALED' ? <Clock className="h-5 w-5 text-amber-400" /> : <AlertCircle className="h-5 w-5 text-red-400" />}
              <span className="text-sm font-bold text-white">{testResult?.passed || trialTest?.status === 'PASSED' ? 'Test Passed!' : trialTest?.status === 'OVERRIDE_PASS' ? 'Passed (Admin Override)' : trialTest?.status === 'APPEALED' ? 'Appeal Under Review' : trialTest?.status === 'OVERRIDE_FAIL' ? 'Failed (Admin Decision)' : 'Test Failed'}</span>
            </div>
            <p className="text-xs text-muted-foreground">{testResult?.feedback || trialTest?.feedback || 'Processing...'}</p>
            {trialTest?.score != null && <p className="text-xs font-bold text-white/60 mt-2">Score: {trialTest.score}/{trialTest.maxScore} ({Math.round((trialTest.score / trialTest.maxScore) * 100)}%)</p>}
          </div>
          
        </div>
      )}
    </div>
  )
}

type PunishmentEntry = {
  id: string
  createdAt: string
  issuedBy?: { username?: string; role?: string; discordId?: string }
  target?: { username?: string; discordId?: string }
  username?: string
  discordId?: string
  moderatorName?: string
  moderatorId?: string
  reason?: string
  proofUrl?: string
  type: string
  proof?: string
  description?: string
}

function PunishmentsTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [punishments, setPunishments] = useState<PunishmentEntry[]>([])
  const [form, setForm] = useState({
    username: '',
    discordId: '',
    type: 'Warning',
    proof: '',
    description: ''
  })

  const loadPunishments = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true)
    try {
      const res = await fetch('/api/admin/punishments')
      if (res.ok) {
        const d = await res.json()
        setPunishments(d.punishments || [])
      }
    } catch {
      /* ignore */
    } finally {
      if (!opts?.silent) setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPunishments()
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void loadPunishments({ silent: true })
    }
    const id = window.setInterval(tick, DASHBOARD_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadPunishments({ silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadPunishments])

  const submitLog = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/admin/punishments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (res.ok) {
        toastSuccess('Punishment Logged', 'The punishment has been recorded securely.')
        setForm({ username: '', discordId: '', type: 'Warning', proof: '', description: '' })
        await loadPunishments()
      } else {
        const d = await res.json()
        toastError('Failed to Log', d.error || 'Unknown error occurred.')
      }
    } catch (err: any) {
      toastError('Network Error', err.message || 'Could not connect to server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-red-500/20 rounded-2xl border border-red-500/30">
            <Gavel className="h-6 w-6 text-red-400" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center">Punishment Logging</h3>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Officially record a user moderation action</p>
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl p-6 sm:p-8 max-w-3xl border border-white/10 shadow-2xl">
        <form onSubmit={submitLog} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Discord Username</label>
              <input type="text" required value={form.username} onChange={e => setForm({...form, username: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50" placeholder="e.g. Wumpus" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Discord ID</label>
              <input type="text" required value={form.discordId} onChange={e => setForm({...form, discordId: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50" placeholder="e.g. 123456789012345678" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Punishment Type</label>
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 appearance-none">
              <option value="Warning">Warning</option>
              <option value="Kick">Kick</option>
              <option value="Temp Ban">Temp Ban</option>
              <option value="SoftBan">SoftBan</option>
              <option value="Perm Ban">Perm Ban</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Proof (Link / URL)</label>
            <input type="url" value={form.proof} onChange={e => setForm({...form, proof: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50" placeholder="https://imgur.com/... (Optional but recommended)" />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Detailed Description</label>
            <textarea required value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none" placeholder="Explain what happened and why this action was taken..." />
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center space-x-2 mt-4 shadow-lg shadow-red-500/10">
            {loading ? <Activity className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            <span>Submit Official Log</span>
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-widest">All logged punishments</h4>
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Newest first · who issued each entry</p>
          </div>
          <button
            type="button"
            onClick={() => loadPunishments()}
            disabled={listLoading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-white/80 disabled:opacity-50"
          >
            {listLoading ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        {listLoading && punishments.length === 0 ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Activity className="h-8 w-8 animate-spin opacity-40" />
          </div>
        ) : punishments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 border border-dashed border-white/10 rounded-2xl">No punishments logged yet.</p>
        ) : (
          <ul className="space-y-3">
            {punishments.map((p) => {
              const target = p.target ?? { username: p.username, discordId: p.discordId }
              const issuedBy = p.issuedBy ?? { username: p.moderatorName, role: 'STAFF', discordId: p.moderatorId }
              const description = p.description ?? p.reason ?? ''
              const proof = p.proof ?? p.proofUrl ?? ''

              return (
              <li
                key={p.id}
                className="glass rounded-2xl border border-white/10 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-red-400 uppercase tracking-wider">{p.type}</p>
                    <p className="text-sm font-bold text-white mt-1">
                      {target.username || 'Unknown User'}
                      <span className="text-muted-foreground font-mono text-xs font-normal ml-2">{target.discordId || 'No Discord ID'}</span>
                    </p>
                  </div>
                  <time className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap">{description}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground font-bold uppercase tracking-widest border-t border-white/5 pt-3">
                  <span>
                    Issued by <span className="text-indigo-300">{issuedBy.username || 'Unknown Moderator'}</span>
                    <span className="text-white/40 font-normal normal-case ml-1">({(issuedBy.role || 'STAFF').replace(/_/g, ' ')})</span>
                  </span>
                  {proof ? (
                    <a href={proof} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline normal-case">
                      Proof link
                    </a>
                  ) : null}
                </div>
              </li>
            )})}
          </ul>
        )}
      </div>
    </div>
  )
}

function SettingsTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const router = useRouter()
  const [notifyEmail, setNotifyEmail] = useState(true)
  const [notifyDm, setNotifyDm] = useState(true)
  const [antiPhishingCode, setAntiPhishingCode] = useState<string | null>(null)
  const [regeneratingCode, setRegeneratingCode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [loading, setLoading] = useState(true)

  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0) // 0=none, 1=requested, 2=submitting
  const [deleteCode, setDeleteCode] = useState('')

  useEffect(() => {
    fetch('/api/user/settings')
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setNotifyEmail(data.user.notifyEmail)
          setNotifyDm(data.user.notifyDm)
          setAntiPhishingCode(data.user.antiPhishingCode ?? null)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const copyAntiPhishingCode = async () => {
    if (!antiPhishingCode) return
    try {
      await navigator.clipboard.writeText(antiPhishingCode)
      setCopiedCode(true)
      toastSuccess('Anti-phishing code copied')
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      toastError('Could not copy code')
    }
  }

  const regenerateAntiPhishingCode = async () => {
    if (!confirm('Generate a new anti-phishing code? Emails and Discord DMs will show the new code going forward.')) return
    setRegeneratingCode(true)
    try {
      const res = await fetch('/api/user/anti-phishing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true }),
      })
      const data = await res.json()
      if (res.ok && data.code) {
        setAntiPhishingCode(data.code)
        toastSuccess('New anti-phishing code generated')
      } else {
        toastError(data.error || 'Failed to regenerate code')
      }
    } catch {
      toastError('Failed to regenerate code')
    } finally {
      setRegeneratingCode(false)
    }
  }

  const saveToggles = async (email: boolean, dm: boolean) => {
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyEmail: email, notifyDm: dm })
      })
      if (res.ok) {
        toastSuccess('Settings updated')
      }
    } catch {
      toastError('Failed to update settings')
    }
  }

  const handleSuspend = async () => {
    if (!confirm('Are you sure you want to suspend your account? You will be logged out and your API keys will be temporarily disabled until you log back in.')) return
    try {
      const res = await fetch('/api/user/settings/suspend', { method: 'POST' })
      if (res.ok) {
        toastSuccess('Account suspended. Logging out...')
        setTimeout(() => signOut(), 2000)
      } else {
        toastError('Failed to suspend account')
      }
    } catch {
      toastError('Failed to suspend account')
    }
  }

  const requestDeletion = async () => {
    try {
      const res = await fetch('/api/user/settings/delete-request', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toastSuccess(data.message)
        setDeleteStep(1)
      } else {
        toastError(data.error || 'Failed to request deletion')
      }
    } catch {
      toastError('Failed to request deletion')
    }
  }

  const confirmDeletion = async () => {
    if (!deleteCode || deleteCode.length !== 6) {
      toastError('Please enter the 6-digit authorization code')
      return
    }
    setDeleteStep(2)
    try {
      const res = await fetch('/api/user/settings/delete-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: deleteCode })
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess(data.message)
        setTimeout(() => signOut(), 2000)
      } else {
        toastError(data.error || 'Failed to delete account')
        setDeleteStep(1)
      }
    } catch {
      toastError('Failed to delete account')
      setDeleteStep(1)
    }
  }

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Anti-Phishing Code */}
      <div className="glass p-6 md:p-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex items-center space-x-4 mb-6">
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Anti-Phishing Code</h2>
            <p className="text-sm text-muted-foreground mt-1">Every legitimate OpenSteam email and Discord DM includes this personal code.</p>
          </div>
        </div>

        <p className="text-sm text-white/60 mb-4 leading-relaxed">
          If you receive an email or Discord DM claiming to be from OpenSteam but it is missing your code below, do not click links or reply. We will never ask you to share this code in Discord or support chat.
        </p>

        <div className="rounded-xl border border-emerald-500/20 bg-black/30 px-4 py-5 text-center mb-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/70 mb-2 font-semibold">
            Your Code
          </p>
          <p className="text-2xl font-mono font-bold tracking-[0.18em] text-white">
            {antiPhishingCode || '—'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void copyAntiPhishingCode()}
            disabled={!antiPhishingCode}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          >
            {copiedCode ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            Copy code
          </button>
          <button
            type="button"
            onClick={() => void regenerateAntiPhishingCode()}
            disabled={regeneratingCode}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-sm font-semibold text-emerald-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${regeneratingCode ? 'animate-spin' : ''}`} />
            Regenerate code
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className="glass p-6 md:p-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex items-center space-x-4 mb-6">
          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Notification Preferences</h2>
            <p className="text-sm text-muted-foreground mt-1">Choose how you want to receive updates.</p>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl">
            <div>
              <p className="font-medium text-white">Email Notifications</p>
              <p className="text-xs text-muted-foreground mt-1">Receive important alerts and updates via email.</p>
            </div>
            <button
              onClick={() => {
                const newVal = !notifyEmail
                setNotifyEmail(newVal)
                saveToggles(newVal, notifyDm)
              }}
              className={`w-12 h-6 rounded-full transition-colors relative ${notifyEmail ? 'bg-indigo-500' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifyEmail ? 'translate-x-6' : ''}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl">
            <div>
              <p className="font-medium text-white">Discord DMs</p>
              <p className="text-xs text-muted-foreground mt-1">Receive alerts directly in your Discord DMs.</p>
            </div>
            <button
              onClick={() => {
                const newVal = !notifyDm
                setNotifyDm(newVal)
                saveToggles(notifyEmail, newVal)
              }}
              className={`w-12 h-6 rounded-full transition-colors relative ${notifyDm ? 'bg-indigo-500' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifyDm ? 'translate-x-6' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Suspension */}
      <div className="glass p-6 md:p-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex items-center space-x-4 mb-6">
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Suspend Account</h2>
            <p className="text-sm text-muted-foreground mt-1">Temporarily disable your API keys and access.</p>
          </div>
        </div>
        
        <p className="text-sm text-amber-200/70 mb-6 bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
          Suspending your account will immediately disable all your API keys. You will be logged out. To reactivate your account, simply log back in to the dashboard.
        </p>

        <button
          onClick={handleSuspend}
          className="px-6 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm font-bold tracking-wide rounded-xl border border-amber-500/20 transition-all flex items-center space-x-2"
        >
          <Clock className="h-4 w-4" />
          <span>Suspend Account</span>
        </button>
      </div>

      {/* Danger Zone */}
      <div className="glass p-6 md:p-8 border-red-500/20 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex items-center space-x-4 mb-6">
          <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400">
            <Trash2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-red-400 tracking-tight">Danger Zone</h2>
            <p className="text-sm text-red-400/60 mt-1">Permanently delete your account and data.</p>
          </div>
        </div>

        {deleteStep === 0 && (
          <>
            <p className="text-sm text-red-300/80 mb-6 bg-red-500/10 p-4 rounded-xl border border-red-500/20">
              Deleting your account is permanent. All your data, API keys, and settings will be wiped. You will receive an email with your exported data. 
              To proceed, we will email you a 6-digit authorization code.
            </p>
            <button
              onClick={requestDeletion}
              className="px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-bold tracking-wide rounded-xl border border-red-500/20 transition-all flex items-center space-x-2"
            >
              <Trash2 className="h-4 w-4" />
              <span>Request Account Deletion</span>
            </button>
          </>
        )}

        {deleteStep >= 1 && (
          <div className="space-y-4">
            <p className="text-sm text-red-300/80 mb-2">
              We have sent a 6-digit authorization code to your email. Enter it below to confirm permanent deletion.
            </p>
            <input 
              type="text" 
              placeholder="000000"
              value={deleteCode}
              onChange={(e) => setDeleteCode(e.target.value)}
              className="w-full max-w-xs bg-black/40 border border-red-500/30 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500/50 text-center tracking-widest text-lg font-mono"
              maxLength={6}
            />
            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={confirmDeletion}
                disabled={deleteStep === 2}
                className="px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold tracking-wide rounded-xl transition-all disabled:opacity-50"
              >
                {deleteStep === 2 ? 'Deleting...' : 'Confirm Deletion'}
              </button>
              <button
                onClick={() => setDeleteStep(0)}
                disabled={deleteStep === 2}
                className="px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-bold tracking-wide rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
